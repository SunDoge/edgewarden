import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { factory } from "../../http/factory";
import {
	AdminPasswordSchema,
	CreateInviteSchema,
	DeleteInvitesQuerySchema,
	RegistrationPolicySchema,
	SetUserStatusSchema,
} from "../../schemas/admin";
import { deleteAccountData } from "../../services/account-deletion";
import { verifyAdminPassword } from "../../services/admin-auth";
import { auditEventInsertQuery, auditRequestMetadata } from "../../services/audit";
import { invalidateUserCache } from "../../services/auth";
import {
	decryptCredential,
	encryptCredential,
	hashCredential,
} from "../../services/credential-protection";
import { conditionalRefreshTokenDeletionQuery } from "../../services/db/batch";
import { getPushRelayStatus } from "../../services/push-relay";
import {
	loadRegistrationPolicy,
	REGISTRATION_CONFIG_KEY,
	registrationPolicyQuery,
} from "../../services/registration-policy";
import { errorResponse } from "../../utils/response";
import { now, toIso } from "../../utils/time";
import { userYubicoPublicIds } from "../../utils/yubico";

// Raw invite codes are encrypted for display and independently hashed for database lookup; plaintext is never stored.
async function inviteResponse(
	request: Request,
	dataEncryptionSecret: string,
	invite: {
		code: string;
		code_encrypted: string;
		email: string | null;
		created_by: string;
		used_by: string | null;
		expires_at: number;
		status: string;
		created_at: number;
		updated_at: number;
	},
) {
	const code = await decryptCredential(
		invite.code_encrypted,
		dataEncryptionSecret,
		"invite-code",
	);
	return {
		code,
		email: invite.email,
		status: invite.status,
		createdBy: invite.created_by,
		usedBy: invite.used_by,
		createdAt: toIso(invite.created_at),
		updatedAt: toIso(invite.updated_at),
		expiresAt: toIso(invite.expires_at),
		inviteLink: `${new URL(request.url).origin}/register?invite=${encodeURIComponent(code)}`,
		object: "invite",
	};
}

export const listAdminInvites = factory.createHandlers(async (c) => {
	const includeInactive = c.req.query("includeInactive") === "true";
	let query = c.get("db").selectFrom("invites").selectAll();
	if (!includeInactive)
		query = query
			.where("status", "=", "active")
			.where("expires_at", ">", now());
	const invites = await query.orderBy("created_at", "desc").execute();
	return c.json({
		data: await Promise.all(
			invites.map((invite) =>
				inviteResponse(c.req.raw, c.env.DATA_ENCRYPTION_SECRET, invite),
			),
		),
		object: "list",
		continuationToken: null,
	});
});

export const createAdminInvite = factory.createHandlers(
	vValidator("json", CreateInviteSchema),
	async (c) => {
		const body = c.req.valid("json");
		const passwordError = await verifyAdminPassword(
			c,
			body.masterPasswordHash,
		);
		if (passwordError) return passwordError;
		const ts = now();
		const rawCode = Array.from(
			crypto.getRandomValues(new Uint8Array(20)),
			(byte) => byte.toString(16).padStart(2, "0"),
		).join("");
		const code = await hashCredential(rawCode);
		const db = c.get("db");
		const normalizedEmail = body.email.trim().toLowerCase();
		await c.get("dbDialect").batch([
			db
				.insertInto("invites")
				.values({
					code,
					code_encrypted: await encryptCredential(
						rawCode,
						c.env.DATA_ENCRYPTION_SECRET,
						"invite-code",
					),
					email: normalizedEmail,
					created_by: c.get("user").id,
					used_by: null,
					expires_at: ts + body.expiresInHours * 3600,
					status: "active",
					created_at: ts,
					updated_at: ts,
				})
				.compile(),
			auditEventInsertQuery(
				db,
				{
					actorUserId: c.get("user").id,
					action: "admin.invite.create",
					category: "admin",
					targetType: "invite",
					metadata: {
						...auditRequestMetadata(c.req.raw),
						status: "active",
						email: normalizedEmail,
					},
				},
				sql<boolean>`EXISTS (SELECT 1 FROM invites WHERE code = ${code})`,
				ts,
			),
		]);
		const invite = await db
			.selectFrom("invites")
			.selectAll()
			.where("code", "=", code)
			.executeTakeFirstOrThrow();
		return c.json(
			await inviteResponse(c.req.raw, c.env.DATA_ENCRYPTION_SECRET, invite),
			201,
		);
	},
);

export const deleteAdminInvite = factory.createHandlers(
	vValidator("json", AdminPasswordSchema),
	async (c) => {
		const passwordError = await verifyAdminPassword(
			c,
			c.req.valid("json").masterPasswordHash,
		);
		if (passwordError) return passwordError;
		const rawCode = c.req.param("code");
		if (!rawCode) return errorResponse("Invite code required", 400);
		const code = await hashCredential(rawCode);
		const db = c.get("db");
		const [, result] = await c.get("dbDialect").batch([
			auditEventInsertQuery(
				db,
				{
					actorUserId: c.get("user").id,
					action: "admin.invite.delete",
					category: "admin",
					targetType: "invite",
					metadata: auditRequestMetadata(c.req.raw),
				},
				sql<boolean>`EXISTS (SELECT 1 FROM invites WHERE code = ${code})`,
			),
			db.deleteFrom("invites").where("code", "=", code).compile(),
		]);
		if (!Number(result.numAffectedRows))
			return errorResponse("Invite not found", 404);
		return new Response(null, { status: 204 });
	},
);

export const deleteAdminInvites = factory.createHandlers(
	vValidator("query", DeleteInvitesQuerySchema),
	vValidator("json", AdminPasswordSchema),
	async (c) => {
		const passwordError = await verifyAdminPassword(
			c,
			c.req.valid("json").masterPasswordHash,
		);
		if (passwordError) return passwordError;
		const db = c.get("db");
		const timestamp = now();
		const invalidOnly = c.req.valid("query").scope === "invalid";
		let query = db.deleteFrom("invites");
		if (invalidOnly)
			query = query.where((eb) =>
				eb.or([
					eb("status", "!=", "active"),
					eb("expires_at", "<=", timestamp),
				]),
			);
		const eligible = invalidOnly
			? sql<boolean>`EXISTS (
				SELECT 1 FROM invites
				WHERE status != 'active' OR expires_at <= ${timestamp}
			)`
			: sql<boolean>`EXISTS (SELECT 1 FROM invites)`;
		const [, result] = await c.get("dbDialect").batch([
			auditEventInsertQuery(
				db,
				{
					actorUserId: c.get("user").id,
					action: "admin.invite.delete.bulk",
					category: "admin",
					level: "warning",
					targetType: "invite",
					metadata: auditRequestMetadata(c.req.raw),
				},
				eligible,
				timestamp,
			),
			query.compile(),
		]);
		return c.json({ deleted: Number(result.numAffectedRows) });
	},
);
