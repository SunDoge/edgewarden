import type { Context } from "hono";
import type { HonoEnv } from "../env";
import { checkAccountRateLimit } from "../middleware/rate-limit";
import { invalidateUserCache, verifyPassword } from "../services/auth";
import {
	constantTimeCredentialEqual,
	decryptCredential,
	hashCredential,
} from "../services/credential-protection";
import * as authRequestsDb from "../services/db/auth-requests";
import {
	conditionalRefreshTokenDeletionQuery,
	conditionalTwoFactorCredentialDeletionQuery,
	conditionalUserRevisionQuery,
} from "../services/db/batch";
import * as usersDb from "../services/db/users";
import * as webauthnDb from "../services/db/webauthn";
import { issueIdentitySession } from "../services/identity-session";
import {
	isLoginLocked,
	loginAttemptIdentifierHash,
	recordLoginFailure,
} from "../services/login-attempts";
import {
	getPushRelayStatus,
	logPushRelayFailure,
	pushDeviceRegistrationFromDatabase,
} from "../services/push-relay";
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
	buildTokenResponse,
	isWebClient,
	readDeviceInfo,
	setWebRefreshCookie,
	TWO_FACTOR_AUTHENTICATOR,
	TWO_FACTOR_RECOVERY,
	TWO_FACTOR_WEBAUTHN,
	TWO_FACTOR_YUBIKEY,
	twoFactorRequiredResponse,
} from "./identity-token-helpers";
import { assertTwoFactorPasskey } from "./two-factor-passkeys";

export async function handlePasswordGrant(
	c: Context<HonoEnv>,
): Promise<Response> {
	const db = c.get("db");
	const body = c.get("tokenRequest");
	const email = body.username?.toLowerCase();
	const passwordHash = body.password;
	const twoFactorToken = body.twoFactorToken ?? body.TwoFactorToken ?? "";
	const twoFactorProvider =
		body.twoFactorProvider ?? body.TwoFactorProvider ?? "";
	const deviceInfo = readDeviceInfo(body);
	if (!getPushRelayStatus(c.env).enabled) deviceInfo.pushToken = null;

	if (turnstileEnabled(c.env)) {
		const captchaResponse = body.captchaResponse ?? body.CaptchaResponse ?? "";
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
	if (
		!(await checkAccountRateLimit(c, email)) ||
		(await isLoginLocked(db, email))
	) {
		return identityErrorResponse(
			"Too many failed login attempts.",
			"TooManyRequests",
			429,
		);
	}

	let user = await usersDb.getUserByEmail(db, email);
	if (!user || user.status !== "active") {
		await recordLoginFailure(db, email);
		return identityErrorResponse(
			"Username or password is incorrect. Try again",
			"invalid_grant",
			400,
		);
	}

	const authRequestId = (body.authRequest ?? body.AuthRequest ?? "").trim();
	let valid = false;
	let validatedAuthRequestId: string | null = null;
	if (authRequestId) {
		const request = await authRequestsDb.getAuthRequestById(db, authRequestId);
		if (
			request &&
			request.user_id === user.id &&
			request.type === 0 &&
			request.approved === 1 &&
			request.response_date &&
			!request.authentication_date &&
			!authRequestsDb.isAuthRequestExpired(request) &&
			constantTimeCredentialEqual(
				request.access_code_hash,
				await hashCredential(passwordHash),
			)
		) {
			valid = true;
			validatedAuthRequestId = request.id;
		}
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
	const twoFactorPasskeys =
		await webauthnDb.countAccountPasskeyCredentialsByUserId(
			db,
			user.id,
			"twoFactor",
		);
	const yubicoIds = userYubicoPublicIds(user);
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
		if (!provider || !token) {
			return twoFactorRequiredResponse(c.req.raw, c.env, db, user);
		}

		if (provider === String(TWO_FACTOR_AUTHENTICATOR)) {
			if (!(await verifyTotpToken(totpSecret ?? "", token))) {
				return identityErrorResponse(
					"Two-step token is invalid. Try again.",
					"invalid_grant",
					400,
				);
			}
		} else if (provider === String(TWO_FACTOR_WEBAUTHN)) {
			try {
				const parsed = parseJsonWithSchema(
					token,
					v.object({
						token: v.string(),
						deviceResponse: v.unknown(),
					}),
				);
				await assertTwoFactorPasskey(
					c.req.raw,
					c.env,
					db,
					c.get("dbDialect"),
					user.id,
					{
						token: String(parsed.token ?? ""),
						deviceResponse: parsed.deviceResponse,
					},
				);
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
			const timestamp = now();
			const securityStamp = crypto.randomUUID();
			const [consumed] = await c.get("dbDialect").batch([
				db
					.updateTable("users")
					.set({
						totp_secret: null,
						totp_recovery_code: null,
						yubikey_config: JSON.stringify({ keys: [], nfc: false }),
						security_stamp: securityStamp,
						updated_at: timestamp,
					})
					.where("id", "=", user.id)
					.where("totp_recovery_code", "=", user.totp_recovery_code),
				conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
				conditionalTwoFactorCredentialDeletionQuery(db, user.id, securityStamp),
				conditionalUserRevisionQuery(db, user.id, securityStamp, timestamp),
			]);
			if (consumed.numAffectedRows !== 1n) {
				return identityErrorResponse(
					"Recovery code is invalid.",
					"invalid_grant",
					400,
				);
			}
			invalidateUserCache(user.id);
			const updatedUser = await usersDb.getUserById(db, user.id);
			if (!updatedUser || updatedUser.status !== "active") {
				return identityErrorResponse(
					"Account is unavailable.",
					"invalid_grant",
					400,
				);
			}
			user = updatedUser;
		} else {
			return identityErrorResponse(
				"Two-step token is invalid. Try again.",
				"invalid_grant",
				400,
			);
		}
	}

	const session = await issueIdentitySession({
		db,
		dialect: c.get("dbDialect"),
		user,
		device: deviceInfo,
		jwtSecret: c.env.JWT_SECRET,
		loginFailureIdentifierHash: await loginAttemptIdentifierHash(email),
		authRequest: validatedAuthRequestId
			? { id: validatedAuthRequestId, token: crypto.randomUUID() }
			: null,
	});
	if (!session) {
		return identityErrorResponse(
			"Authentication request has already been used.",
			"invalid_grant",
			400,
		);
	}
	const { accessToken, refreshToken } = session;
	if (deviceInfo.pushToken && session.deviceSession) {
		c.executionCtx.waitUntil(
			pushDeviceRegistrationFromDatabase(
				c.env,
				user.id,
				session.deviceSession.identifier,
			).catch((error) =>
				logPushRelayFailure("push.device.login-register.failed", error),
			),
		);
	}
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
}
import { parseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";
