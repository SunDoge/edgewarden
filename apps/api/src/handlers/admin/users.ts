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

// Administrative status changes use compare-and-swap updates and revoke sessions only after the matching security stamp commits.
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
