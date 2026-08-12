import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { factory } from "../http/factory";
import {
	SaveYubicoConfigSchema,
	SaveYubicoKeysSchema,
	YubicoSettingsSchema,
} from "../schemas/two-factor";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import { invalidateUserCache, verifyPassword } from "../services/auth";
import { encryptCredential } from "../services/credential-protection";
import {
	conditionalRefreshTokenDeletionQuery,
	conditionalUserRevisionQuery,
	conditionalYubikeyUpdateQuery,
} from "../services/db/batch";
import {
	loadYubicoCredentials,
	prepareYubicoCredentialsUpdate,
	YUBICO_CONFIG_KEY,
} from "../services/yubico-config";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";
import {
	parseYubikeyConfig,
	serializeYubikeyConfig,
	verifyYubicoOtp,
	yubicoPublicId,
} from "../utils/yubico";

function recoveryCode(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	)
		.join("")
		.toUpperCase();
}

async function verified(c: any, hash: string): Promise<boolean> {
	const user = c.get("user");
	return verifyPassword(hash, user.master_password_hash, user.email);
}

async function settingsPayload(c: any) {
	const user = c.get("user");
	const yubikey = parseYubikeyConfig(user.yubikey_config);
	return {
		enabled: yubikey.keys.length > 0,
		keys: yubikey.keys,
		nfc: yubikey.nfc,
		configured: Boolean(await loadYubicoCredentials(c.get("db"), c.env)),
		canManageConfig: user.role === "admin",
		object: "twoFactorYubiKey" as const,
	};
}

export const getYubikeySettings = factory.createHandlers(
	vValidator("json", YubicoSettingsSchema),
	async (c) => {
		if (!(await verified(c, c.req.valid("json").masterPasswordHash)))
			return errorResponse("Master password verification failed", 400);
		return c.json(await settingsPayload(c));
	},
);

export const saveYubikeys = factory.createHandlers(
	vValidator("json", SaveYubicoKeysSchema),
	async (c) => {
		const body = c.req.valid("json");
		if (!(await verified(c, body.masterPasswordHash)))
			return errorResponse("Master password verification failed", 400);
		const credentials = await loadYubicoCredentials(c.get("db"), c.env);
		if (!credentials)
			return errorResponse(
				"Yubico validation credentials are not configured",
				409,
			);
		const publicIds: string[] = [];
		for (const otp of body.otps) {
			const publicId = yubicoPublicId(otp);
			if (!publicId || !(await verifyYubicoOtp(otp, credentials)))
				return errorResponse("Invalid YubiKey OTP", 400);
			if (publicIds.includes(publicId))
				return errorResponse("Duplicate YubiKey", 400);
			publicIds.push(publicId);
		}
		const user = c.get("user");
		const db = c.get("db");
		const ts = now();
		const securityStamp = crypto.randomUUID();
		const encryptedRecoveryCode =
			user.totp_recovery_code ??
			(await encryptCredential(
				recoveryCode(),
				c.env.DATA_ENCRYPTION_SECRET,
				"totp-recovery",
			));
		const [changed] = await c.get("dbDialect").batch([
			conditionalYubikeyUpdateQuery(
				db,
				user.id,
				user.security_stamp,
				user.yubikey_config,
				serializeYubikeyConfig({ keys: publicIds, nfc: body.nfc }),
				encryptedRecoveryCode,
				securityStamp,
				ts,
			),
			conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
			conditionalUserRevisionQuery(db, user.id, securityStamp, ts),
			auditEventInsertQuery(
				db,
				{
					actorUserId: user.id,
					action: "account.two_factor.yubikey.enable",
					category: "auth",
					targetType: "user",
					targetId: user.id,
					metadata: {
						...auditRequestMetadata(c.req.raw),
						size: publicIds.length,
					},
				},
				sql<boolean>`EXISTS (
						SELECT 1 FROM users
						WHERE id = ${user.id} AND security_stamp = ${securityStamp}
					)`,
				ts,
			),
		]);
		if (changed.numAffectedRows !== 1n)
			return errorResponse("YubiKey settings changed by another request", 409);
		invalidateUserCache(user.id);
		const updated = await db
			.selectFrom("users")
			.selectAll()
			.where("id", "=", user.id)
			.executeTakeFirstOrThrow();
		c.set("user", updated);
		return c.json(await settingsPayload(c));
	},
);

export const disableYubikeys = factory.createHandlers(
	vValidator("json", YubicoSettingsSchema),
	async (c) => {
		const body = c.req.valid("json");
		if (!(await verified(c, body.masterPasswordHash)))
			return errorResponse("Master password verification failed", 400);
		const user = c.get("user");
		const db = c.get("db");
		const disabledResponse = () =>
			c.json({
				enabled: false,
				keys: [],
				nfc: false,
				object: "twoFactorYubiKey" as const,
			});
		if (parseYubikeyConfig(user.yubikey_config).keys.length === 0)
			return disabledResponse();
		const ts = now();
		const securityStamp = crypto.randomUUID();
		const [updated] = await c.get("dbDialect").batch([
			db
				.updateTable("users")
				.set({
					yubikey_config: serializeYubikeyConfig({ keys: [], nfc: false }),
					security_stamp: securityStamp,
					updated_at: ts,
				})
				.where("id", "=", user.id)
				.where("yubikey_config", "=", user.yubikey_config)
				.compile(),
			conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
			conditionalUserRevisionQuery(db, user.id, securityStamp, ts),
			auditEventInsertQuery(
				db,
				{
					actorUserId: user.id,
					action: "account.two_factor.yubikey.disable",
					category: "auth",
					targetType: "user",
					targetId: user.id,
					metadata: auditRequestMetadata(c.req.raw),
				},
				sql<boolean>`EXISTS (
					SELECT 1 FROM users
					WHERE id = ${user.id} AND security_stamp = ${securityStamp}
				)`,
				ts,
			),
		]);
		if (updated.numAffectedRows !== 1n) return disabledResponse();
		invalidateUserCache(user.id);
		return disabledResponse();
	},
);

export const saveYubicoConfig = factory.createHandlers(
	vValidator("json", SaveYubicoConfigSchema),
	async (c) => {
		const body = c.req.valid("json");
		if (!(await verified(c, body.masterPasswordHash)))
			return errorResponse("Master password verification failed", 400);
		try {
			atob(body.secretKey);
		} catch {
			return errorResponse("Yubico secret key must be valid base64", 400);
		}
		const db = c.get("db");
		const prepared = await prepareYubicoCredentialsUpdate(
			db,
			c.env.DATA_ENCRYPTION_SECRET,
			{ clientId: body.clientId, secretKey: body.secretKey },
		);
		await c.get("dbDialect").batch([
			prepared.query,
			auditEventInsertQuery(
				db,
				{
					actorUserId: c.get("user").id,
					action: "admin.yubico.config",
					category: "admin",
					level: "warning",
					targetType: "config",
					targetId: YUBICO_CONFIG_KEY,
					metadata: auditRequestMetadata(c.req.raw),
				},
				sql<boolean>`EXISTS (
					SELECT 1 FROM config
					WHERE key = ${YUBICO_CONFIG_KEY} AND value = ${prepared.value}
				)`,
			),
		]);
		return c.json({ configured: true, object: "yubicoConfig" });
	},
);
