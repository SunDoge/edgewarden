import { getCookie } from "hono/cookie";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import {
	checkAccountRateLimit,
	checkIpRateLimit,
} from "../middleware/rate-limit";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { verifyPassword } from "../services/auth";
import {
	constantTimeCredentialEqual,
	decryptCredential,
	hashCredential,
} from "../services/credential-protection";
import * as authRequestsDb from "../services/db/auth-requests";
import * as usersDb from "../services/db/users";
import * as webauthnDb from "../services/db/webauthn";
import { authenticateApiKey } from "../services/identity-api-key";
import { refreshIdentitySession } from "../services/identity-refresh";
import { issueIdentitySession } from "../services/identity-session";
import {
	clearLoginFailures,
	isLoginLocked,
	recordLoginFailure,
} from "../services/login-attempts";
import { turnstileEnabled, verifyTurnstileToken } from "../services/turnstile";
import { loadYubicoCredentials } from "../services/yubico-config";
import { identityErrorResponse } from "../utils/response";
import { now } from "../utils/time";
import { isTotpEnabled, verifyTotpToken } from "../utils/totp";
import {
	userYubicoPublicIds,
	verifyYubicoOtp,
	yubicoPublicId,
} from "../utils/yubico";
import {
	assertAccountPasskeyCredential,
	buildAccountPasskeyTokenUserDecryptionOption,
} from "./account-passkeys";
import {
	buildTokenResponse,
	isWebClient,
	readDeviceInfo,
	setWebRefreshCookie,
	TWO_FACTOR_AUTHENTICATOR,
	TWO_FACTOR_RECOVERY,
	TWO_FACTOR_WEBAUTHN,
	TWO_FACTOR_YUBIKEY,
	twoFactorRequiredResponse,
	webRefreshCookieName,
} from "./identity-token-helpers";
import { assertTwoFactorPasskey } from "./two-factor-passkeys";

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
		if (turnstileEnabled(c.env)) {
			const captchaResponse =
				body.captchaResponse ?? body.CaptchaResponse ?? "";
			const remoteIp = c.req.header("CF-Connecting-IP") ?? undefined;
			if (
				!(await verifyTurnstileToken(c.env, captchaResponse, "login", remoteIp))
			) {
				return identityErrorResponse(
					"Human verification failed. Please try again.",
					"CaptchaRequired",
					400,
				);
			}
		}

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
		if (await isLoginLocked(db, email)) {
			return identityErrorResponse(
				"Too many failed login attempts.",
				"TooManyRequests",
				429,
			);
		}

		const user = await usersDb.getUserByEmail(db, email);
		if (!user || user.status !== "active") {
			await recordLoginFailure(db, email);
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
				constantTimeCredentialEqual(
					ar.access_code_hash,
					await hashCredential(passwordHash),
				)
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
			await recordLoginFailure(db, email);
			return identityErrorResponse(
				"Username or password is incorrect. Try again",
				"invalid_grant",
				400,
			);
		}
		await clearLoginFailures(db, email);

		const twoFactorPasskeys =
			await webauthnDb.countAccountPasskeyCredentialsByUserId(
				db,
				user.id,
				"twoFactor",
			);
		const yubicoIds = userYubicoPublicIds(user);
		// Verify any configured second-factor provider.
		let totpSecret: string | null = null;
		let recoveryCode: string | null = null;
		try {
			totpSecret = user.totp_secret
				? await decryptCredential(
						user.totp_secret,
						c.env.DATA_ENCRYPTION_SECRET,
						"totp-secret",
					)
				: null;
			recoveryCode = user.totp_recovery_code
				? await decryptCredential(
						user.totp_recovery_code,
						c.env.DATA_ENCRYPTION_SECRET,
						"totp-recovery",
					)
				: null;
		} catch {
			return identityErrorResponse(
				"Two-step configuration could not be decrypted",
				"server_error",
				500,
			);
		}
		if (
			isTotpEnabled(totpSecret) ||
			twoFactorPasskeys > 0 ||
			yubicoIds.length > 0
		) {
			const provider = twoFactorProvider.trim();
			const token = twoFactorToken.trim();
			if (!provider || !token)
				return await twoFactorRequiredResponse(c.req.raw, c.env, db, user);

			if (provider === String(TWO_FACTOR_AUTHENTICATOR)) {
				const ok = await verifyTotpToken(totpSecret ?? "", token);
				if (!ok)
					return identityErrorResponse(
						"Two-step token is invalid. Try again.",
						"invalid_grant",
						400,
					);
			} else if (provider === String(TWO_FACTOR_WEBAUTHN)) {
				try {
					const parsed = JSON.parse(token) as {
						token?: string;
						deviceResponse?: unknown;
					};
					await assertTwoFactorPasskey(c.req.raw, c.env, db, user.id, {
						token: String(parsed.token ?? ""),
						deviceResponse: parsed.deviceResponse,
					});
				} catch {
					return identityErrorResponse(
						"Two-step passkey is invalid. Try again.",
						"invalid_grant",
						400,
					);
				}
			} else if (provider === String(TWO_FACTOR_YUBIKEY)) {
				const credentials = await loadYubicoCredentials(db, c.env);
				const publicId = yubicoPublicId(token);
				if (
					!credentials ||
					!publicId ||
					!yubicoIds.includes(publicId) ||
					!(await verifyYubicoOtp(token, credentials))
				) {
					return identityErrorResponse(
						"YubiKey OTP is invalid. Try again.",
						"invalid_grant",
						400,
					);
				}
			} else if (
				provider === String(TWO_FACTOR_RECOVERY) ||
				provider === "-1" ||
				provider === "100"
			) {
				if (!recoveryCode || token !== recoveryCode) {
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

		if (validatedAuthRequestId) {
			await authRequestsDb.markAuthRequestAuthenticated(
				db,
				validatedAuthRequestId,
			);
		}

		const { accessToken, refreshToken } = await issueIdentitySession({
			db,
			dialect: c.get("dbDialect"),
			user,
			device: deviceInfo,
			jwtSecret: secret,
		});

		if (isWebClient(body)) setWebRefreshCookie(c, refreshToken);
		return c.json(
			buildTokenResponse(
				accessToken,
				refreshToken,
				user,
				undefined,
				null,
				!isWebClient(body),
			),
		);

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
		const { accessToken, refreshToken, deviceSession } =
			await issueIdentitySession({
				db,
				dialect: c.get("dbDialect"),
				user,
				device: deviceInfo,
				jwtSecret: secret,
			});

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

		if (isWebClient(body)) setWebRefreshCookie(c, refreshToken);
		return c.json(
			buildTokenResponse(
				accessToken,
				refreshToken,
				user,
				undefined,
				webAuthnPrfOption,
				!isWebClient(body),
			),
		);

		// ── refresh_token grant ─────────────────────────────────────────────────
	} else if (grantType === "refresh_token") {
		const webClient = isWebClient(body);
		const rawToken =
			body.refresh_token ||
			(webClient ? getCookie(c, webRefreshCookieName(c.req.url)) : undefined);
		if (!rawToken) {
			return identityErrorResponse(
				"Refresh token is required",
				"invalid_grant",
				400,
			);
		}

		const refreshed = await refreshIdentitySession({
			db,
			dialect: c.get("dbDialect"),
			rawToken,
			jwtSecret: secret,
		});
		if (!refreshed.ok) {
			const message =
				refreshed.reason === "invalid_refresh_token"
					? "Refresh token is invalid or expired"
					: refreshed.reason === "inactive_account"
						? "Account not found or inactive"
						: "Device session is invalid";
			return identityErrorResponse(message, "invalid_grant", 400);
		}

		if (webClient) setWebRefreshCookie(c, refreshed.refreshToken);
		return c.json(
			buildTokenResponse(
				refreshed.accessToken,
				refreshed.refreshToken,
				refreshed.user,
				undefined,
				null,
				!webClient,
			),
		);

		// ── client_credentials grant ────────────────────────────────────────────
	} else if (grantType === "client_credentials") {
		const authenticated = await authenticateApiKey({
			db,
			clientId: body.client_id ?? "",
			clientSecret: body.client_secret ?? "",
			jwtSecret: secret,
		});
		if (!authenticated.ok && authenticated.reason === "invalid_client_id") {
			return identityErrorResponse(
				"Invalid client_id format",
				"invalid_request",
				400,
			);
		}
		if (!authenticated.ok) {
			return identityErrorResponse(
				"Invalid client credentials",
				"invalid_client",
				400,
			);
		}
		return c.json({
			access_token: authenticated.accessToken,
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
