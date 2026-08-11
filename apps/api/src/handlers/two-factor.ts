import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
	DisableTotpSchema,
	RecoverTwoFactorSchema,
	TotpSetupSchema,
} from "../schemas/two-factor";
import { invalidateUserCache, verifyPassword } from "../services/auth";
import { executeBatch } from "../services/db/batch";
import * as usersDb from "../services/db/users";
import {
	checkAccountRateLimit,
	checkIpRateLimit,
} from "../middleware/rate-limit";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import {
	decryptCredential,
	encryptCredential,
} from "../services/credential-protection";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";
import { serializeYubikeyConfig } from "../utils/yubico";
import { isTotpEnabled, verifyTotpToken } from "../utils/totp";
import * as webauthnDb from "../services/db/webauthn";
import { userYubicoPublicIds } from "../utils/yubico";

const TOTP_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function randomBase32Secret(length = 32): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let out = "";
	for (const byte of bytes) out += TOTP_BASE32[byte % TOTP_BASE32.length];
	return out;
}

function generateRecoveryCode(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}

export const listTwoFactor = factory.createHandlers(async (c) => {
	const providers: Array<{ enabled: boolean; type: number; object: string }> =
		[];
	if (isTotpEnabled(c.get("user").totp_secret))
		providers.push({ enabled: true, type: 0, object: "twoFactorProvider" });
	if (userYubicoPublicIds(c.get("user") as any).length)
		providers.push({ enabled: true, type: 3, object: "twoFactorProvider" });
	if (
		await webauthnDb.countAccountPasskeyCredentialsByUserId(
			c.get("db"),
			c.get("user").id,
			"twoFactor",
		)
	)
		providers.push({ enabled: true, type: 7, object: "twoFactorProvider" });
	return c.json({ data: providers, object: "list", continuationToken: null });
});

export const getAuthenticator = factory.createHandlers(async (c) => {
	const encryptedSecret = c.get("user").totp_secret;
	let secret = randomBase32Secret();
	if (encryptedSecret) {
		try {
			secret = await decryptCredential(
				encryptedSecret,
				c.env.DATA_ENCRYPTION_SECRET,
				"totp-secret",
			);
		} catch {
			return errorResponse(
				"Authenticator configuration cannot be decrypted",
				500,
			);
		}
	}
	return c.json({
		key: secret,
		enabled: Boolean(encryptedSecret),
		object: "twoFactorAuthenticator",
	});
});

export const enableAuthenticator = factory.createHandlers(
	vValidator("json", TotpSetupSchema),
	async (c) => {
		const { token, key } = c.req.valid("json");
		if (!(await verifyTotpToken(key, token))) {
			return errorResponse("TOTP token is invalid.", 400);
		}
		const db = c.get("db");
		const userId = c.get("user").id;
		const ts = now();
		const [encryptedSecret, encryptedRecoveryCode] = await Promise.all([
			encryptCredential(key, c.env.DATA_ENCRYPTION_SECRET, "totp-secret"),
			encryptCredential(
				generateRecoveryCode(),
				c.env.DATA_ENCRYPTION_SECRET,
				"totp-recovery",
			),
		]);
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("users")
				.set({
					totp_secret: encryptedSecret,
					totp_recovery_code: encryptedRecoveryCode,
					security_stamp: crypto.randomUUID(),
					updated_at: ts,
				})
				.where("id", "=", userId)
				.compile(),
			db.deleteFrom("refresh_tokens").where("user_id", "=", userId).compile(),
		]);
		invalidateUserCache(userId);
		return c.json({ key, enabled: true, object: "twoFactorAuthenticator" });
	},
);

function disableAuthenticatorHandler(providerResponse: boolean) {
	return factory.createHandlers(
		vValidator("json", DisableTotpSchema),
		async (c) => {
			const user = c.get("user");
			const { masterPasswordHash } = c.req.valid("json");
			if (
				!(await verifyPassword(
					masterPasswordHash,
					user.master_password_hash,
					user.email,
				))
			) {
				return errorResponse("Password is incorrect.", 400);
			}
			const db = c.get("db");
			await executeBatch(c.get("dbDialect"), [
				db
					.updateTable("users")
					.set({
						totp_secret: null,
						totp_recovery_code: null,
						security_stamp: crypto.randomUUID(),
						updated_at: now(),
					})
					.where("id", "=", user.id)
					.compile(),
				db
					.deleteFrom("refresh_tokens")
					.where("user_id", "=", user.id)
					.compile(),
			]);
			invalidateUserCache(user.id);
			return providerResponse
				? c.json({ enabled: false, type: 0, object: "twoFactorProvider" })
				: c.json({ enabled: false, object: "twoFactorAuthenticator" });
		},
	);
}

export const disableAuthenticator = disableAuthenticatorHandler(false);
export const disableTwoFactor = disableAuthenticatorHandler(true);

export const getRecoveryCode = factory.createHandlers(async (c) => {
	const encrypted = c.get("user").totp_recovery_code;
	if (!encrypted) return c.json({ code: null, object: "twoFactorRecovery" });
	try {
		return c.json({
			code: await decryptCredential(
				encrypted,
				c.env.DATA_ENCRYPTION_SECRET,
				"totp-recovery",
			),
			object: "twoFactorRecovery",
		});
	} catch {
		return errorResponse("Recovery code cannot be decrypted", 500);
	}
});

function normalizeRecoveryCode(value: string): string {
	return value.replace(/[\s-]/g, "").toUpperCase();
}

function constantTimeEqual(a: string, b: string): boolean {
	const left = new TextEncoder().encode(a);
	const right = new TextEncoder().encode(b);
	let difference = left.length ^ right.length;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++)
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	return difference === 0;
}

/** Public recovery requires both independent secrets and always returns a generic failure. */
export const recoverTwoFactor = factory.createHandlers(
	vValidator("json", RecoverTwoFactorSchema),
	async (c) => {
		const body = c.req.valid("json");
		const email = body.email.trim().toLowerCase();
		if (
			!(await checkIpRateLimit(c)) ||
			!(await checkAccountRateLimit(c, email))
		) {
			return errorResponse("Too many recovery attempts. Try again later.", 429);
		}
		const db = c.get("db");
		const user = await usersDb.getUserByEmail(db, email);
		const suppliedCode = normalizeRecoveryCode(body.recoveryCode);
		const validPassword = user
			? await verifyPassword(
					body.masterPasswordHash,
					user.master_password_hash,
					user.email,
				)
			: false;
		let storedRecoveryCode: string | null = null;
		if (user?.totp_recovery_code) {
			try {
				storedRecoveryCode = await decryptCredential(
					user.totp_recovery_code,
					c.env.DATA_ENCRYPTION_SECRET,
					"totp-recovery",
				);
			} catch {
				storedRecoveryCode = null;
			}
		}
		const validCode = storedRecoveryCode
			? constantTimeEqual(
					suppliedCode,
					normalizeRecoveryCode(storedRecoveryCode),
				)
			: false;
		if (!user || user.status !== "active" || !validPassword || !validCode) {
			return errorResponse("Invalid credentials or recovery code.", 400);
		}
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("users")
				.set({
					totp_secret: null,
					totp_recovery_code: null,
					yubikey_config: serializeYubikeyConfig({ keys: [], nfc: false }),
					security_stamp: crypto.randomUUID(),
					updated_at: ts,
				})
				.where("id", "=", user.id)
				.compile(),
			db.deleteFrom("refresh_tokens").where("user_id", "=", user.id).compile(),
			db
				.deleteFrom("webauthn_credentials")
				.where("user_id", "=", user.id)
				.where("purpose", "=", "twoFactor")
				.compile(),
		]);
		invalidateUserCache(user.id);
		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "account.two_factor.recovered",
			category: "auth",
			level: "warning",
			targetType: "user",
			targetId: user.id,
			metadata: { ...auditRequestMetadata(c.req.raw), email },
		});
		return new Response(null, { status: 204 });
	},
);
