import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { factory } from "../http/factory";
import {
	AdminPasswordSchema,
	CreateInviteSchema,
	DeleteInvitesQuerySchema,
	RegistrationPolicySchema,
	SetUserStatusSchema,
} from "../schemas/admin";
import { deleteAccountData } from "../services/account-deletion";
import { verifyAdminPassword } from "../services/admin-auth";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import { invalidateUserCache } from "../services/auth";
import {
	decryptCredential,
	encryptCredential,
	hashCredential,
} from "../services/credential-protection";
import { conditionalRefreshTokenDeletionQuery } from "../services/db/batch";
import { getPushRelayStatus } from "../services/push-relay";
import {
	loadRegistrationPolicy,
	REGISTRATION_CONFIG_KEY,
	registrationPolicyQuery,
} from "../services/registration-policy";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";
import { userYubicoPublicIds } from "../utils/yubico";

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

export const listAdminUsers = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const users = await db
		.selectFrom("users")
		.select([
			"id",
			"email",
			"name",
			"role",
			"status",
			"totp_secret",
			"yubikey_config",
			"created_at",
			"updated_at",
			sql<number>`exists (
				select 1
				from webauthn_credentials as credential
				where credential.user_id = users.id
					and credential.purpose = 'twoFactor'
			)`.as("has_two_factor_passkey"),
		])
		.orderBy("created_at", "desc")
		.execute();
	return c.json({
		data: users.map((user) => ({
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			status: user.status,
			twoFactorEnabled: Boolean(
				user.totp_secret ||
					userYubicoPublicIds(user).length ||
					user.has_two_factor_passkey,
			),
			creationDate: toIso(user.created_at),
			revisionDate: toIso(user.updated_at),
			object: "user",
		})),
		object: "list",
		continuationToken: null,
	});
});

export const getAdminRegistrationPolicy = factory.createHandlers(async (c) =>
	c.json({
		...(await loadRegistrationPolicy(c.get("db"), c.env)),
		object: "registrationPolicy",
	}),
);

export const getAdminPushRelayStatus = factory.createHandlers(async (c) =>
	c.json({ ...getPushRelayStatus(c.env), object: "pushRelayStatus" }),
);

export const updateAdminRegistrationPolicy = factory.createHandlers(
	vValidator("json", RegistrationPolicySchema),
	async (c) => {
		const body = c.req.valid("json");
		const passwordError = await verifyAdminPassword(
			c as any,
			body.masterPasswordHash,
		);
		if (passwordError) return passwordError;
		const policy = {
			signupsAllowed: body.signupsAllowed,
			invitationsAllowed: body.invitationsAllowed,
		};
		const db = c.get("db");
		const serializedPolicy = JSON.stringify(policy);
		await c.get("dbDialect").batch([
			registrationPolicyQuery(db, policy),
			auditEventInsertQuery(
				db,
				{
					actorUserId: c.get("user").id,
					action: "admin.registration.settings",
					category: "admin",
					level: "warning",
					targetType: "config",
					targetId: REGISTRATION_CONFIG_KEY,
					metadata: {
						...auditRequestMetadata(c.req.raw),
						signupsAllowed: policy.signupsAllowed,
						invitationsAllowed: policy.invitationsAllowed,
					},
				},
				sql<boolean>`EXISTS (
					SELECT 1 FROM config
					WHERE key = ${REGISTRATION_CONFIG_KEY}
					  AND value = ${serializedPolicy}
				)`,
			),
		]);
		return c.json({ ...policy, object: "registrationPolicy" });
	},
);

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
			c as any,
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
			c as any,
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
			c as any,
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

export const setAdminUserStatus = factory.createHandlers(
	vValidator("json", SetUserStatusSchema),
	async (c) => {
		const body = c.req.valid("json");
		const passwordError = await verifyAdminPassword(
			c as any,
			body.masterPasswordHash,
		);
		if (passwordError) return passwordError;
		const targetId = c.req.param("id");
		if (!targetId) return errorResponse("User id required", 400);
		if (targetId === c.get("user").id && body.status === "banned")
			return errorResponse("You cannot ban yourself", 400);
		const db = c.get("db");
		const target = await db
			.selectFrom("users")
			.select(["id", "status"])
			.where("id", "=", targetId)
			.where("deletion_requested_at", "is", null)
			.executeTakeFirst();
		if (!target) return errorResponse("User not found", 404);
		const response = () =>
			c.json({ id: targetId, status: body.status, object: "user" });
		if (target.status === body.status) return response();
		const ts = now();
		const securityStamp = crypto.randomUUID();
		const update = db
			.updateTable("users")
			.set({
				status: body.status,
				updated_at: ts,
				...(body.status === "banned" ? { security_stamp: securityStamp } : {}),
			})
			.where("id", "=", targetId)
			.where("status", "=", target.status)
			.where("deletion_requested_at", "is", null)
			.compile();
		const [updated] = await c.get("dbDialect").batch([
			update,
			...(body.status === "banned"
				? [conditionalRefreshTokenDeletionQuery(db, targetId, securityStamp)]
				: []),
			auditEventInsertQuery(
				db,
				{
					actorUserId: c.get("user").id,
					action: "admin.user.status",
					category: "admin",
					level: "warning",
					targetType: "user",
					targetId,
					metadata: {
						...auditRequestMetadata(c.req.raw),
						status: body.status,
					},
				},
				sql<boolean>`EXISTS (
						SELECT 1 FROM users
						WHERE id = ${targetId}
						  AND status = ${body.status}
						  AND updated_at = ${ts}
						  ${body.status === "banned" ? sql`AND security_stamp = ${securityStamp}` : sql``}
					)`,
				ts,
			),
		]);
		if (updated.numAffectedRows !== 1n)
			return errorResponse("User status changed by another request", 409);
		invalidateUserCache(targetId);
		return response();
	},
);

export const deleteAdminUser = factory.createHandlers(
	vValidator("json", AdminPasswordSchema),
	async (c) => {
		const body = c.req.valid("json");
		const passwordError = await verifyAdminPassword(
			c as any,
			body.masterPasswordHash,
		);
		if (passwordError) return passwordError;
		const targetId = c.req.param("id");
		if (!targetId) return errorResponse("User id required", 400);
		if (targetId === c.get("user").id)
			return errorResponse("You cannot delete yourself", 400);
		const target = await c
			.get("db")
			.selectFrom("users")
			.select("id")
			.where("id", "=", targetId)
			.executeTakeFirst();
		if (!target) return errorResponse("User not found", 404);
		const result = await deleteAccountData(
			c.get("db"),
			c.get("dbDialect"),
			targetId,
			{
				actorUserId: c.get("user").id,
				action: "admin.user.delete",
				category: "admin",
				level: "warning",
				targetType: "user",
				targetId,
				metadata: auditRequestMetadata(c.req.raw),
			},
		);
		if (!result)
			return errorResponse(
				"Delete or transfer organizations owned by this account first",
				409,
			);
		invalidateUserCache(targetId);
		return new Response(null, { status: 204 });
	},
);

export {
	getAuditSettings,
	listAuditLogs,
	updateAuditSettings,
} from "./admin-audit";
