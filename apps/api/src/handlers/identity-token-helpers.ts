import { setCookie } from "hono/cookie";
import type { Kysely, Selectable } from "kysely";
import { LIMITS } from "../config";
import { decryptCredential } from "../services/credential-protection";
import type { DB, Users } from "../types/db";
import { jsonResponse } from "../utils/response";
import { isTotpEnabled } from "../utils/totp";
import {
	buildAccountKeys,
	buildUserDecryptionOptions,
} from "../utils/user-decryption";
import { parseYubikeyConfig, userYubicoPublicIds } from "../utils/yubico";
import { buildTwoFactorPasskeyAssertion } from "./two-factor-passkeys";

export const TWO_FACTOR_AUTHENTICATOR = 0;
export const TWO_FACTOR_RECOVERY = 8;
export const TWO_FACTOR_WEBAUTHN = 7;
export const TWO_FACTOR_YUBIKEY = 3;

export async function twoFactorRequiredResponse(
	request: Request,
	env: CloudflareBindings,
	db: Kysely<DB>,
	user: Selectable<Users>,
): Promise<Response> {
	const providers: string[] = [];
	const totpSecret = user.totp_secret
		? await decryptCredential(
				user.totp_secret,
				env.DATA_ENCRYPTION_SECRET,
				"totp-secret",
			)
		: null;
	if (isTotpEnabled(totpSecret))
		providers.push(String(TWO_FACTOR_AUTHENTICATOR));
	if (userYubicoPublicIds(user).length)
		providers.push(String(TWO_FACTOR_YUBIKEY));
	const webAuthn = await buildTwoFactorPasskeyAssertion(
		request,
		env,
		db,
		user.id,
	);
	if (webAuthn) providers.push(String(TWO_FACTOR_WEBAUTHN));
	const providers2: Record<string, Record<string, unknown>> = {};
	for (const provider of providers) providers2[provider] = { Email: null };
	if (webAuthn)
		providers2[String(TWO_FACTOR_WEBAUTHN)] = {
			Email: null,
			Challenge: webAuthn,
		};
	if (userYubicoPublicIds(user).length)
		providers2[String(TWO_FACTOR_YUBIKEY)] = {
			Email: null,
			Nfc: parseYubikeyConfig(user.yubikey_config).nfc,
		};
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

export function readDeviceInfo(body: Record<string, unknown>) {
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

export function buildTokenResponse(
	accessToken: string,
	refreshToken: string,
	user: Selectable<Users>,
	twoFactorToken?: string,
	webAuthnPrfOption: unknown = null,
	exposeRefreshToken = true,
) {
	return {
		access_token: accessToken,
		expires_in: LIMITS.auth.accessTokenTtlSeconds,
		token_type: "Bearer",
		...(exposeRefreshToken ? { refresh_token: refreshToken } : {}),
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

export function webRefreshCookieName(requestUrl: string): string {
	return new URL(requestUrl).protocol === "https:"
		? "__Host-edgewarden_refresh"
		: "edgewarden_refresh";
}

export function isWebClient(body: Record<string, unknown>): boolean {
	return String(body.client_id ?? "").trim() === "web";
}

export function setWebRefreshCookie(
	c: Parameters<typeof setCookie>[0],
	token: string,
): void {
	setCookie(c, webRefreshCookieName(c.req.url), token, {
		httpOnly: true,
		secure: new URL(c.req.url).protocol === "https:",
		sameSite: "Strict",
		path: "/",
		maxAge: LIMITS.auth.refreshTokenTtlSeconds,
	});
}
