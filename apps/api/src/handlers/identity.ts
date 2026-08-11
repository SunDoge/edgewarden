import { vValidator } from "@hono/valibot-validator";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import {
	checkAccountRateLimit,
	checkIpRateLimit,
} from "../middleware/rate-limit";
import { PreloginSchema } from "../schemas/identity";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import {
	createRefreshToken,
	generateAccessToken,
	verifyPassword,
} from "../services/auth";
import * as authRequestsDb from "../services/db/auth-requests";
import * as devicesDb from "../services/db/devices";
import * as refreshTokensDb from "../services/db/refresh-tokens";
import { executeBatch, revisionQuery } from "../services/db/batch";
import * as usersDb from "../services/db/users";
import { identityErrorResponse, jsonResponse } from "../utils/response";
import { now } from "../utils/time";
import { isTotpEnabled, verifyTotpToken } from "../utils/totp";
import {
	buildAccountKeys,
	buildUserDecryptionOptions,
} from "../utils/user-decryption";
import {
	assertAccountPasskeyCredential,
	buildAccountPasskeyTokenUserDecryptionOption,
	handleGetAccountPasskeyAssertionOptions,
} from "./account-passkeys";
import { hashRefreshToken } from "../utils/jwt";
import * as webauthnDb from "../services/db/webauthn";
import { assertTwoFactorPasskey, buildTwoFactorPasskeyAssertion } from "./two-factor-passkeys";
import { loadYubicoCredentials } from "../services/yubico-config";
import { parseYubikeyConfig, userYubicoPublicIds, verifyYubicoOtp, yubicoPublicId } from "../utils/yubico";

const TWO_FACTOR_AUTHENTICATOR = 0;
const TWO_FACTOR_RECOVERY = 8;
const TWO_FACTOR_WEBAUTHN = 7;
const TWO_FACTOR_YUBIKEY = 3;

async function twoFactorRequiredResponse(request: Request, env: CloudflareBindings, db: any, user: any): Promise<Response> {
	const providers: string[] = [];
	if (isTotpEnabled(user.totp_secret)) providers.push(String(TWO_FACTOR_AUTHENTICATOR));
	if (userYubicoPublicIds(user).length) providers.push(String(TWO_FACTOR_YUBIKEY));
	const webAuthn = await buildTwoFactorPasskeyAssertion(request, env, db, user.id);
	if (webAuthn) providers.push(String(TWO_FACTOR_WEBAUTHN));
	const providers2: Record<string, Record<string, unknown>> = {};
	for (const p of providers) providers2[p] = { Email: null };
	if (webAuthn) providers2[String(TWO_FACTOR_WEBAUTHN)] = { Email: null, Challenge: webAuthn };
	if (userYubicoPublicIds(user).length) providers2[String(TWO_FACTOR_YUBIKEY)] = { Email: null, Nfc: parseYubikeyConfig(user.yubikey_config).nfc };
	return jsonResponse(
		{
			error: "invalid_grant",
			error_description: "Two factor required.",
			TwoFactorProviders: providers,
			TwoFactorProviders2: providers2,
			SsoEmail2faSessionToken: null,
			MasterPasswordPolicy: { Object: "masterPasswordPolicy" },
			CustomResponse: {
				TwoFactorProviders: providers,
				TwoFactorProviders2: providers2,
			},
			ErrorModel: { Message: "Two factor required.", Object: "error" },
		},
		400,
	);
}

function readDeviceInfo(body: Record<string, unknown>) {
	const identifier = String(
		body.deviceIdentifier ?? body.DeviceIdentifier ?? "",
	).trim();
	const name = String(body.deviceName ?? body.DeviceName ?? "Unknown").slice(
		0,
		128,
	);
	const type = Number(body.deviceType ?? body.DeviceType ?? 0);
	return { identifier, name, type };
}

function buildTokenResponse(
	accessToken: string,
	refreshToken: string,
	user: Awaited<ReturnType<typeof usersDb.getUserById>> & object,
	twoFactorToken?: string,
	webAuthnPrfOption: any = null,
) {
	return {
		access_token: accessToken,
		expires_in: LIMITS.auth.accessTokenTtlSeconds,
		token_type: "Bearer",
		refresh_token: refreshToken,
		...(twoFactorToken ? { TwoFactorToken: twoFactorToken } : {}),
		Key: user.key,
		PrivateKey: user.private_key,
		AccountKeys: buildAccountKeys(user),
		accountKeys: buildAccountKeys(user),
		Kdf: user.kdf_type,
		KdfIterations: user.kdf_iterations,
		KdfMemory: user.kdf_memory ?? null,
		KdfParallelism: user.kdf_parallelism ?? null,
		ForcePasswordReset: false,
		ResetMasterPassword: false,
		MasterPasswordPolicy: { Object: "masterPasswordPolicy" },
		ApiUseKeyConnector: false,
		scope: "api offline_access",
		unofficialServer: true,
		UserDecryptionOptions: buildUserDecryptionOptions(user, webAuthnPrfOption),
		userDecryptionOptions: buildUserDecryptionOptions(user, webAuthnPrfOption),
	};
}

// POST /identity/accounts/prelogin
export const prelogin = factory.createHandlers(
	vValidator("json", PreloginSchema),
	async (c) => {
		const { email } = c.req.valid("json");
		const db = c.get("db");
		const user = await usersDb.getUserByEmail(db, email);
		const kdfType = user?.kdf_type ?? 0;
		const kdfIterations =
			user?.kdf_iterations ?? LIMITS.auth.defaultKdfIterations;
		return c.json({
			kdf: kdfType,
			kdfIterations,
			kdfMemory: user?.kdf_memory ?? null,
			kdfParallelism: user?.kdf_parallelism ?? null,
			KdfSettings: {
				KdfType: kdfType,
				Iterations: kdfIterations,
				Memory: user?.kdf_memory ?? null,
				Parallelism: user?.kdf_parallelism ?? null,
			},
			Salt: email.toLowerCase(),
		});
	},
);

export const getPasskeyAssertionOptions = factory.createHandlers(
	handleGetAccountPasskeyAssertionOptions,
);

// POST /identity/connect/token
export const connectToken = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const secret = c.env.JWT_SECRET;

	// IP rate limit on login endpoint
	if (!(await checkIpRateLimit(c))) {
		return identityErrorResponse(
			"Too many requests. Try again later.",
			"TooManyRequests",
			429,
		);
	}

	const body = c.get("tokenRequest");

	const grantType = body.grant_type;

	// ── password grant ──────────────────────────────────────────────────────
	if (grantType === "password") {
		const email = body.username?.toLowerCase();
		const passwordHash = body.password;
		const twoFactorToken = body.twoFactorToken ?? body.TwoFactorToken ?? "";
		const twoFactorProvider =
			body.twoFactorProvider ?? body.TwoFactorProvider ?? "";
		const deviceInfo = readDeviceInfo(body);

		if (!email || !passwordHash) {
			return identityErrorResponse(
				"Email and password are required",
				"invalid_request",
				400,
			);
		}
		if (!(await checkAccountRateLimit(c, email))) {
			return identityErrorResponse(
				"Too many failed login attempts.",
				"TooManyRequests",
				429,
			);
		}

		const user = await usersDb.getUserByEmail(db, email);
		if (!user || user.status !== "active") {
			return identityErrorResponse(
				"Username or password is incorrect. Try again",
				"invalid_grant",
				400,
			);
		}

		// Auth request flow
		const authRequestId = (body.authRequest ?? body.AuthRequest ?? "").trim();
		let valid = false;
		let validatedAuthRequestId: string | null = null;
		if (authRequestId) {
			const ar = await authRequestsDb.getAuthRequestById(db, authRequestId);
			valid = !!(
				ar &&
				ar.user_id === user.id &&
				ar.type === 0 &&
				ar.approved === 1 &&
				ar.response_date &&
				!ar.authentication_date &&
				!authRequestsDb.isAuthRequestExpired(ar) &&
				ar.access_code === passwordHash
			);
			if (valid) validatedAuthRequestId = ar!.id;
		} else {
			valid = await verifyPassword(
				passwordHash,
				user.master_password_hash,
				user.email,
			);
		}

		if (!valid) {
			return identityErrorResponse(
				"Username or password is incorrect. Try again",
				"invalid_grant",
				400,
			);
		}

		const twoFactorPasskeys = await webauthnDb.countAccountPasskeyCredentialsByUserId(db, user.id, "twoFactor");
		const yubicoIds = userYubicoPublicIds(user);
		// Verify any configured second-factor provider.
		if (isTotpEnabled(user.totp_secret) || twoFactorPasskeys > 0 || yubicoIds.length > 0) {
			const provider = twoFactorProvider.trim();
			const token = twoFactorToken.trim();
			if (!provider || !token) return await twoFactorRequiredResponse(c.req.raw, c.env, db, user);

			if (provider === String(TWO_FACTOR_AUTHENTICATOR)) {
				const ok = await verifyTotpToken(user.totp_secret ?? "", token);
				if (!ok)
					return identityErrorResponse(
						"Two-step token is invalid. Try again.",
						"invalid_grant",
						400,
					);
			} else if (provider === String(TWO_FACTOR_WEBAUTHN)) {
				try {
					const parsed = JSON.parse(token) as { token?: string; deviceResponse?: unknown };
					await assertTwoFactorPasskey(c.req.raw, c.env, db, user.id, { token: String(parsed.token ?? ""), deviceResponse: parsed.deviceResponse });
				} catch {
					return identityErrorResponse("Two-step passkey is invalid. Try again.", "invalid_grant", 400);
				}
			} else if (provider === String(TWO_FACTOR_YUBIKEY)) {
				const credentials = await loadYubicoCredentials(db, c.env);
				const publicId = yubicoPublicId(token);
				if (!credentials || !publicId || !yubicoIds.includes(publicId) || !(await verifyYubicoOtp(token, credentials))) {
					return identityErrorResponse("YubiKey OTP is invalid. Try again.", "invalid_grant", 400);
				}
			} else if (
				provider === String(TWO_FACTOR_RECOVERY) ||
				provider === "-1" ||
				provider === "100"
			) {
				if (!user.totp_recovery_code || token !== user.totp_recovery_code) {
					return identityErrorResponse(
						"Recovery code is invalid.",
						"invalid_grant",
						400,
					);
				}
				// Invalidate TOTP on recovery code use
				await usersDb.updateUser(db, user.id, {
					totp_secret: null,
					totp_recovery_code: null,
					updated_at: now(),
				});
			} else {
				return identityErrorResponse(
					"Two-step token is invalid. Try again.",
					"invalid_grant",
					400,
				);
			}
		}

		// Upsert device
		let deviceSession: { identifier: string; sessionStamp: string } | null =
			null;
		if (deviceInfo.identifier) {
			const existing = await devicesDb.getDevice(
				db,
				user.id,
				deviceInfo.identifier,
			);
			const sessionStamp = existing?.session_stamp ?? crypto.randomUUID();
			await devicesDb.upsertDevice(
				db,
				user.id,
				deviceInfo.identifier,
				deviceInfo.name,
				deviceInfo.type,
				sessionStamp,
			);
			deviceSession = { identifier: deviceInfo.identifier, sessionStamp };
		}

		if (validatedAuthRequestId) {
			await authRequestsDb.markAuthRequestAuthenticated(
				db,
				validatedAuthRequestId,
			);
		}

		const accessToken = await generateAccessToken(user, deviceSession, secret);
		const refreshToken = createRefreshToken();
		const sessionTime = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.insertInto("refresh_tokens")
				.values({
					token: await hashRefreshToken(refreshToken),
					user_id: user.id,
					expires_at: sessionTime + LIMITS.auth.refreshTokenTtlSeconds,
					device_identifier: deviceSession?.identifier ?? null,
					device_session_stamp: deviceSession?.sessionStamp ?? null,
				})
				.compile(),
			revisionQuery(db, user.id, sessionTime),
		]);

		return c.json(buildTokenResponse(accessToken, refreshToken, user));

		// ── webauthn grant ──────────────────────────────────────────────────────
	} else if (grantType === "webauthn") {
		const token = String(body.token || "").trim();
		let deviceResponse: unknown = body.deviceResponse;
		if (typeof deviceResponse === "string") {
			try {
				deviceResponse = JSON.parse(deviceResponse);
			} catch {
				return identityErrorResponse(
					"Invalid passkey response",
					"invalid_request",
					400,
				);
			}
		}
		if (!token || !deviceResponse) {
			return identityErrorResponse(
				"Passkey token and deviceResponse are required",
				"invalid_request",
				400,
			);
		}

		let asserted: Awaited<ReturnType<typeof assertAccountPasskeyCredential>>;
		try {
			asserted = await assertAccountPasskeyCredential(c.req.raw, c.env, db, {
				token,
				deviceResponse,
				scope: "Authentication",
			});
		} catch (error: any) {
			await safeWriteAuditEvent(db, {
				actorUserId: null,
				action: "auth.passkey.login.failed",
				category: "auth",
				level: "warning",
				targetType: "accountPasskey",
				targetId: null,
				metadata: {
					grantType,
					reason: error.message || "assertion_failed",
					...auditRequestMetadata(c.req.raw),
				},
			});
			return identityErrorResponse(
				"Passkey is invalid. Try again",
				"invalid_grant",
				400,
			);
		}

		const { user, credential } = asserted;
		if (user.status !== "active") {
			return identityErrorResponse("Account is disabled", "invalid_grant", 400);
		}

		const deviceInfo = readDeviceInfo(body);
		let deviceSession: { identifier: string; sessionStamp: string } | null =
			null;
		if (deviceInfo.identifier) {
			const existing = await devicesDb.getDevice(
				db,
				user.id,
				deviceInfo.identifier,
			);
			const sessionStamp = existing?.session_stamp ?? crypto.randomUUID();
			await devicesDb.upsertDevice(
				db,
				user.id,
				deviceInfo.identifier,
				deviceInfo.name,
				deviceInfo.type,
				sessionStamp,
			);
			deviceSession = { identifier: deviceInfo.identifier, sessionStamp };
		}

		const accessToken = await generateAccessToken(user, deviceSession, secret);
		const refreshToken = createRefreshToken();
		const sessionTime = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.insertInto("refresh_tokens")
				.values({
					token: await hashRefreshToken(refreshToken),
					user_id: user.id,
					expires_at: sessionTime + LIMITS.auth.refreshTokenTtlSeconds,
					device_identifier: deviceSession?.identifier ?? null,
					device_session_stamp: deviceSession?.sessionStamp ?? null,
				})
				.compile(),
			revisionQuery(db, user.id, sessionTime),
		]);

		const webAuthnPrfOption =
			buildAccountPasskeyTokenUserDecryptionOption(credential);

		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "auth.passkey.login.success",
			category: "auth",
			level: "info",
			targetType: "accountPasskey",
			targetId: credential.id,
			metadata: {
				grantType,
				deviceIdentifier: deviceSession?.identifier ?? deviceInfo.identifier,
				deviceType: deviceInfo.type,
				...auditRequestMetadata(c.req.raw),
			},
		});

		return c.json(
			buildTokenResponse(
				accessToken,
				refreshToken,
				user,
				undefined,
				webAuthnPrfOption,
			),
		);

		// ── refresh_token grant ─────────────────────────────────────────────────
	} else if (grantType === "refresh_token") {
		const rawToken = body.refresh_token;
		if (!rawToken) {
			return identityErrorResponse(
				"Refresh token is required",
				"invalid_grant",
				400,
			);
		}

		const record = await refreshTokensDb.getRefreshTokenRecord(db, rawToken);
		if (!record) {
			return identityErrorResponse(
				"Refresh token is invalid or expired",
				"invalid_grant",
				400,
			);
		}

		const user = await usersDb.getUserById(db, record.userId);
		if (!user || user.status !== "active") {
			await refreshTokensDb.deleteRefreshToken(db, rawToken);
			return identityErrorResponse(
				"Account not found or inactive",
				"invalid_grant",
				400,
			);
		}

		let deviceSession: { identifier: string; sessionStamp: string } | null =
			null;
		if (record.deviceIdentifier && record.deviceSessionStamp) {
			const device = await devicesDb.getDevice(
				db,
				user.id,
				record.deviceIdentifier,
			);
			if (!device || device.session_stamp !== record.deviceSessionStamp) {
				await refreshTokensDb.deleteRefreshToken(db, rawToken);
				return identityErrorResponse(
					"Device session is invalid",
					"invalid_grant",
					400,
				);
			}
			if (!device.session_stamp) {
				return identityErrorResponse(
					"Device session is invalid",
					"invalid_grant",
					400,
				);
			}
			deviceSession = {
				identifier: device.device_identifier,
				sessionStamp: device.session_stamp,
			};
		}

		// Rotate refresh token atomically to prevent a partially persisted session.
		const newRefreshToken = createRefreshToken();
		const sessionTime = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.deleteFrom("refresh_tokens")
				.where("token", "=", await hashRefreshToken(rawToken))
				.compile(),
			db
				.insertInto("refresh_tokens")
				.values({
					token: await hashRefreshToken(newRefreshToken),
					user_id: user.id,
					expires_at: sessionTime + LIMITS.auth.refreshTokenTtlSeconds,
					device_identifier: deviceSession?.identifier ?? null,
					device_session_stamp: deviceSession?.sessionStamp ?? null,
				})
				.compile(),
		]);

		const accessToken = await generateAccessToken(user, deviceSession, secret);
		return c.json(buildTokenResponse(accessToken, newRefreshToken, user));

		// ── client_credentials grant ────────────────────────────────────────────
	} else if (grantType === "client_credentials") {
		const clientId = (body.client_id ?? "").trim();
		const clientSecret = (body.client_secret ?? "").trim();
		// user.{userId} format
		const match = clientId.match(/^user\.(.+)$/);
		if (!match) {
			return identityErrorResponse(
				"Invalid client_id format",
				"invalid_request",
				400,
			);
		}
		const user = await usersDb.getUserById(db, match[1]);
		if (!user || user.status !== "active" || user.api_key !== clientSecret) {
			return identityErrorResponse(
				"Invalid client credentials",
				"invalid_client",
				400,
			);
		}
		const accessToken = await generateAccessToken(user, null, secret);
		return c.json({
			access_token: accessToken,
			expires_in: LIMITS.auth.accessTokenTtlSeconds,
			token_type: "Bearer",
			scope: "api",
		});
	}

	return identityErrorResponse(
		"Unsupported grant_type",
		"unsupported_grant_type",
		400,
	);
});

// POST /identity/connect/revocation
// POST /identity/connect/revoke
export const revokeToken = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const token = c.get("revocationToken");
	if (token) await refreshTokensDb.deleteRefreshToken(db, token);
	return new Response(null, { status: 200 });
});
