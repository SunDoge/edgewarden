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

// Policy updates and their audit record share one D1 batch so the log only exists for a committed configuration value.
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
			c,
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
