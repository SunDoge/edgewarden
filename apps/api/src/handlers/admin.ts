import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import type { HonoEnv } from "../env";
import { factory } from "../http/factory";
import {
	AdminPasswordSchema,
	AuditLogQuerySchema,
	AuditLogSettingsSchema,
	CreateInviteSchema,
	DeleteInvitesQuerySchema,
	RegistrationPolicySchema,
	SetUserStatusSchema,
} from "../schemas/admin";
import { verifyPassword } from "../services/auth";
import {
	decryptCredential,
	encryptCredential,
	hashCredential,
} from "../services/credential-protection";
import {
	deleteBlobObject,
	getAttachmentObjectKey,
	getSendFileObjectKey,
} from "../services/blob-store";
import * as attachmentsDb from "../services/db/attachments";
import {
	auditRequestMetadata,
	getAuditLogSettings,
	safeWriteAuditEvent,
	saveAuditLogSettings,
} from "../services/audit";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";
import { userYubicoPublicIds } from "../utils/yubico";
import {
	loadRegistrationPolicy,
	saveRegistrationPolicy,
} from "../services/registration-policy";

async function verifyAdminPassword(
	c: Context<HonoEnv>,
	hash: string,
): Promise<Response | null> {
	const user = c.get("user");
	return (await verifyPassword(hash, user.master_password_hash, user.email))
		? null
		: errorResponse("Invalid password", 400);
}

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
		])
		.orderBy("created_at", "desc")
		.execute();
	const passkeys = await db
		.selectFrom("webauthn_credentials")
		.select("user_id")
		.where("purpose", "=", "twoFactor")
		.execute();
	const passkeyUsers = new Set(
		passkeys.map((credential) => credential.user_id),
	);
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
					passkeyUsers.has(user.id),
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
		await saveRegistrationPolicy(c.get("db"), policy);
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "admin.registration.settings",
			category: "admin",
			level: "warning",
			targetType: "config",
			targetId: "registration.policy.v1",
			metadata: {
				...auditRequestMetadata(c.req.raw),
				signupsAllowed: policy.signupsAllowed,
				invitationsAllowed: policy.invitationsAllowed,
			},
		});
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
		await c
			.get("db")
			.insertInto("invites")
			.values({
				code,
				code_encrypted: await encryptCredential(
					rawCode,
					c.env.DATA_ENCRYPTION_SECRET,
					"invite-code",
				),
				email: body.email.trim().toLowerCase(),
				created_by: c.get("user").id,
				used_by: null,
				expires_at: ts + body.expiresInHours * 3600,
				status: "active",
				created_at: ts,
				updated_at: ts,
			})
			.execute();
		const invite = await c
			.get("db")
			.selectFrom("invites")
			.selectAll()
			.where("code", "=", code)
			.executeTakeFirstOrThrow();
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "admin.invite.create",
			category: "admin",
			targetType: "invite",
			metadata: {
				...auditRequestMetadata(c.req.raw),
				status: "active",
				email: body.email.trim().toLowerCase(),
			},
		});
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
		const result = await c
			.get("db")
			.deleteFrom("invites")
			.where("code", "=", code)
			.executeTakeFirst();
		if (!Number(result.numDeletedRows))
			return errorResponse("Invite not found", 404);
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "admin.invite.delete",
			category: "admin",
			targetType: "invite",
			metadata: auditRequestMetadata(c.req.raw),
		});
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
		let query = c.get("db").deleteFrom("invites");
		if (c.req.valid("query").scope === "invalid")
			query = query.where((eb) =>
				eb.or([eb("status", "!=", "active"), eb("expires_at", "<=", now())]),
			);
		const result = await query.executeTakeFirst();
		return c.json({ deleted: Number(result.numDeletedRows) });
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
		const ts = now();
		const result = await c
			.get("db")
			.updateTable("users")
			.set({
				status: body.status,
				updated_at: ts,
				...(body.status === "banned"
					? { security_stamp: crypto.randomUUID() }
					: {}),
			})
			.where("id", "=", targetId)
			.executeTakeFirst();
		if (!Number(result.numUpdatedRows))
			return errorResponse("User not found", 404);
		if (body.status === "banned")
			await c
				.get("db")
				.deleteFrom("refresh_tokens")
				.where("user_id", "=", targetId)
				.execute();
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "admin.user.status",
			category: "admin",
			level: "warning",
			targetType: "user",
			targetId,
			metadata: { ...auditRequestMetadata(c.req.raw), status: body.status },
		});
		return c.json({ id: targetId, status: body.status, object: "user" });
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
			.select(["id", "email"])
			.where("id", "=", targetId)
			.executeTakeFirst();
		if (!target) return errorResponse("User not found", 404);
		const cipherIds = (
			await c
				.get("db")
				.selectFrom("ciphers")
				.select("id")
				.where("user_id", "=", targetId)
				.execute()
		).map((cipher) => cipher.id);
		const attachments = await attachmentsDb.listByCipherIds(
			c.get("db"),
			cipherIds,
		);
		const sends = await c
			.get("db")
			.selectFrom("sends")
			.select(["id", "type", "data"])
			.where("user_id", "=", targetId)
			.execute();
		await Promise.allSettled([
			...attachments.map((attachment) =>
				deleteBlobObject(
					c.env,
					getAttachmentObjectKey(attachment.cipher_id, attachment.id),
				),
			),
			...sends
				.filter((send) => send.type === 1)
				.map(async (send) => {
					const fileId = (JSON.parse(send.data) as { id?: string }).id;
					if (fileId)
						await deleteBlobObject(
							c.env,
							getSendFileObjectKey(send.id, fileId),
						);
				}),
		]);
		await c.get("db").deleteFrom("users").where("id", "=", targetId).execute();
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "admin.user.delete",
			category: "admin",
			level: "warning",
			targetType: "user",
			targetId,
			metadata: {
				...auditRequestMetadata(c.req.raw),
				targetEmail: target.email,
			},
		});
		return new Response(null, { status: 204 });
	},
);

export const listAuditLogs = factory.createHandlers(
	vValidator("query", AuditLogQuerySchema),
	async (c) => {
		const query = c.req.valid("query");
		const limit = query.limit ?? 50;
		const offset = query.offset ?? 0;
		let rows = c
			.get("db")
			.selectFrom("audit_logs as log")
			.leftJoin("users as actor", "actor.id", "log.actor_user_id")
			.select([
				"log.id",
				"log.actor_user_id",
				"actor.email as actor_email",
				"log.action",
				"log.category",
				"log.level",
				"log.target_type",
				"log.target_id",
				"log.metadata",
				"log.created_at",
			]);
		if (query.category) rows = rows.where("log.category", "=", query.category);
		if (query.level) rows = rows.where("log.level", "=", query.level);
		if (query.q)
			rows = rows.where((eb) =>
				eb.or([
					eb("log.action", "like", `%${query.q}%`),
					eb("log.metadata", "like", `%${query.q}%`),
					eb("actor.email", "like", `%${query.q}%`),
				]),
			);
		const data = await rows
			.orderBy("log.created_at", "desc")
			.limit(limit)
			.offset(offset)
			.execute();
		let count = c
			.get("db")
			.selectFrom("audit_logs")
			.select((eb) => eb.fn.countAll<number>().as("total"));
		if (query.category) count = count.where("category", "=", query.category);
		if (query.level) count = count.where("level", "=", query.level);
		if (query.q)
			count = count.where((eb) =>
				eb.or([
					eb("action", "like", `%${query.q}%`),
					eb("metadata", "like", `%${query.q}%`),
				]),
			);
		const total = Number((await count.executeTakeFirst())?.total ?? 0);
		return c.json({
			data: data.map((log) => ({
				id: log.id,
				actorUserId: log.actor_user_id,
				actorEmail: log.actor_email,
				action: log.action,
				category: log.category,
				level: log.level,
				targetType: log.target_type,
				targetId: log.target_id,
				metadata: log.metadata ? JSON.parse(log.metadata) : {},
				createdAt: toIso(log.created_at),
				object: "auditLog",
			})),
			total,
			limit,
			offset,
			hasMore: offset + data.length < total,
			object: "list",
		});
	},
);

export const clearAuditLogs = factory.createHandlers(
	vValidator("json", AdminPasswordSchema),
	async (c) => {
		const passwordError = await verifyAdminPassword(
			c as any,
			c.req.valid("json").masterPasswordHash,
		);
		if (passwordError) return passwordError;
		const result = await c
			.get("db")
			.deleteFrom("audit_logs")
			.executeTakeFirst();
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "admin.audit.clear",
			category: "admin",
			level: "warning",
			metadata: {
				...auditRequestMetadata(c.req.raw),
				size: Number(result.numDeletedRows),
			},
		});
		return c.json({ deleted: Number(result.numDeletedRows) });
	},
);

export const getAuditSettings = factory.createHandlers(async (c) =>
	c.json({
		...(await getAuditLogSettings(c.get("db"))),
		object: "auditLogSettings",
	}),
);

export const updateAuditSettings = factory.createHandlers(
	vValidator("json", AuditLogSettingsSchema),
	async (c) => {
		const body = c.req.valid("json");
		const settings = await saveAuditLogSettings(c.get("db"), {
			retentionDays: body.retentionDays ?? null,
			maxEntries: body.maxEntries ?? null,
		});
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "admin.audit.settings",
			category: "admin",
			metadata: auditRequestMetadata(c.req.raw),
		});
		return c.json({ ...settings, object: "auditLogSettings" });
	},
);
