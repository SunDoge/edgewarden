import {
	KdfType,
	type PreloginResponse,
	type RegisterPayload,
	type TokenResponse,
} from "@edgewarden/shared";
import {
	browserDeviceName,
	getOrCreateDeviceIdentifier,
	WEB_DEVICE_TYPE,
} from "./client-device";
import {
	base64ToBytes,
	bytesToBase64,
	deriveMasterKey,
	deriveMasterPasswordHash,
	encryptBw,
	hkdfExpand,
} from "./crypto";
import {
	assertAccountPasskey,
	unlockVaultKeyWithAccountPasskeyPrf,
} from "./passkeys";
import {
	ApiError,
	getMemoryAccessToken,
	rpc,
	rpcJson,
	rpcVoid,
	setMemoryAccessToken,
} from "./rpc";

export function getAccessToken(): string | null {
	if (typeof window === "undefined") return null;
	return getMemoryAccessToken();
}

export function isLoggedIn(): boolean {
	return !!getAccessToken();
}

export async function logout(): Promise<void> {
	if (typeof window === "undefined") return;
	setMemoryAccessToken(null);
	sessionStorage.removeItem("master_key");
	try {
		await rpc.identity.connect.revocation.$post({ form: { token: "" } });
	} catch {
		// Local logout must still complete while offline.
	}
}

/**
 * 1. Pre-login: Fetch KDF configuration for the given email
 */
export async function prelogin(email: string): Promise<PreloginResponse> {
	const response = await rpc.identity.accounts.prelogin.$post({
		json: { email },
	});
	return rpcJson(response) as Promise<PreloginResponse>;
}

export async function deriveAccountPasswordHash(
	email: string,
	password: string,
): Promise<string> {
	const settings = await prelogin(email);
	const masterKey = await deriveMasterKey(
		password,
		email,
		settings.kdfIterations,
	);
	return deriveMasterPasswordHash(masterKey, password);
}

export async function recoverTwoFactorApi(
	email: string,
	password: string,
	recoveryCode: string,
): Promise<void> {
	const masterPasswordHash = await deriveAccountPasswordHash(email, password);
	rpcVoid(
		await rpc.identity.accounts["recover-2fa"].$post({
			json: {
				email: email.trim().toLowerCase(),
				masterPasswordHash,
				recoveryCode: recoveryCode.trim(),
			},
		}),
	);
}

/**
 * 2. Login: Key derivation + token request.
 * Returns the derived master key so the caller can store it in memory.
 */
export async function login(
	email: string,
	password: string,
	twoFactor?: { token: string; provider?: string },
	captchaResponse?: string,
): Promise<{ masterKey: ArrayBuffer }> {
	const kdfSettings = await prelogin(email);

	const masterKey = await deriveMasterKey(
		password,
		email,
		kdfSettings.kdfIterations,
	);
	const masterPasswordHash = await deriveMasterPasswordHash(
		masterKey,
		password,
	);

	const response = await rpc.identity.connect.token.$post({
		form: {
			grant_type: "password",
			username: email.toLowerCase().trim(),
			password: masterPasswordHash,
			client_id: "web",
			deviceIdentifier: getOrCreateDeviceIdentifier(),
			deviceName: browserDeviceName(),
			deviceType: String(WEB_DEVICE_TYPE),
			...(captchaResponse ? { captchaResponse } : {}),
			...(twoFactor
				? {
						twoFactorToken: twoFactor.token.trim(),
						twoFactorProvider: twoFactor.provider ?? "0",
					}
				: {}),
		},
	});
	const tokenResponse = (await rpcJson(response)) as TokenResponse;

	setMemoryAccessToken(tokenResponse.access_token);

	return { masterKey };
}

export async function getTurnstileConfigApi(): Promise<{
	enabled: boolean;
	siteKey: string | null;
}> {
	const response = await fetch("/api/config", {
		headers: { accept: "application/json" },
	});
	if (!response.ok) throw new Error("无法加载人机验证配置");
	const config = (await response.json()) as {
		turnstile?: { enabled?: boolean; siteKey?: string | null };
	};
	return {
		enabled: config.turnstile?.enabled === true,
		siteKey: config.turnstile?.siteKey ?? null,
	};
}

export interface RegistrationConfig {
	signupsAllowed: boolean;
	invitationsAllowed: boolean;
	bootstrapRequired: boolean;
	adminPasswordConfigured: boolean;
	turnstileEnabled: boolean;
	turnstileSiteKey: string | null;
}

export async function getRegistrationConfigApi(): Promise<RegistrationConfig> {
	const response = await fetch("/api/config", {
		headers: { accept: "application/json" },
	});
	if (!response.ok) throw new Error("无法加载注册配置");
	const config = (await response.json()) as {
		registration?: Partial<RegistrationConfig>;
		turnstile?: { enabled?: boolean; siteKey?: string | null };
	};
	return {
		signupsAllowed: config.registration?.signupsAllowed === true,
		invitationsAllowed: config.registration?.invitationsAllowed === true,
		bootstrapRequired: config.registration?.bootstrapRequired === true,
		adminPasswordConfigured:
			config.registration?.adminPasswordConfigured === true,
		turnstileEnabled: config.turnstile?.enabled === true,
		turnstileSiteKey: config.turnstile?.siteKey ?? null,
	};
}

export function isTwoFactorRequiredError(error: unknown): boolean {
	if (
		!(error instanceof ApiError) ||
		!error.payload ||
		typeof error.payload !== "object"
	)
		return false;
	const payload = error.payload as Record<string, unknown>;
	return (
		payload.error_description === "Two factor required." ||
		"TwoFactorProviders" in payload
	);
}

export function twoFactorPasskeyChallengeFromError(
	error: unknown,
): { options: unknown; token: string } | null {
	if (
		!(error instanceof ApiError) ||
		!error.payload ||
		typeof error.payload !== "object"
	)
		return null;
	const payload = error.payload as any;
	const provider =
		payload.TwoFactorProviders2?.["7"] ??
		payload.CustomResponse?.TwoFactorProviders2?.["7"];
	const challenge = provider?.Challenge ?? provider?.challenge;
	if (!challenge?.options || !challenge?.token) return null;
	return { options: challenge.options, token: String(challenge.token) };
}

export function twoFactorProvidersFromError(error: unknown): string[] {
	if (
		!(error instanceof ApiError) ||
		!error.payload ||
		typeof error.payload !== "object"
	)
		return [];
	const payload = error.payload as any;
	const providers =
		payload.TwoFactorProviders ?? payload.CustomResponse?.TwoFactorProviders;
	return Array.isArray(providers) ? providers.map(String) : [];
}

export async function loginWithPasskeyApi(): Promise<{
	accessToken: string;
	symEncKey?: Uint8Array;
	symMacKey?: Uint8Array;
	masterPasswordUnlock?: {
		email: string;
		iterations: number;
		profileKey: string;
	};
}> {
	const options = await rpcJson<any>(
		await rpc.identity.accounts.webauthn["assertion-options"].$get(),
	);
	const assertion = await assertAccountPasskey(options);
	const response = await rpc.identity.connect.token.$post({
		form: {
			grant_type: "webauthn",
			client_id: "web",
			token: assertion.token,
			deviceResponse: JSON.stringify(assertion.deviceResponse),
		},
	});
	const token = await rpcJson<any>(response);
	if (!token.access_token) throw new Error("通行密钥登录未返回访问令牌");
	const decryption =
		token.UserDecryptionOptions ?? token.userDecryptionOptions ?? {};
	const prfOption =
		decryption.WebAuthnPrfOption ?? decryption.webAuthnPrfOption;
	let keys: { symEncKey: string; symMacKey: string } | undefined;
	if (assertion.prfKey && prfOption)
		keys = await unlockVaultKeyWithAccountPasskeyPrf(
			assertion.prfKey,
			prfOption,
		);
	setMemoryAccessToken(token.access_token);
	if (keys) {
		return {
			accessToken: token.access_token,
			symEncKey: base64ToBytes(keys.symEncKey),
			symMacKey: base64ToBytes(keys.symMacKey),
		};
	}
	const unlock =
		decryption.MasterPasswordUnlock ?? decryption.masterPasswordUnlock ?? {};
	return {
		accessToken: token.access_token,
		masterPasswordUnlock: {
			email: String(unlock.Salt ?? unlock.salt ?? ""),
			iterations: Number(
				unlock.Kdf?.Iterations ??
					unlock.kdf?.iterations ??
					token.KdfIterations ??
					600_000,
			),
			profileKey: String(
				unlock.MasterKeyWrappedUserKey ??
					unlock.masterKeyWrappedUserKey ??
					token.Key ??
					"",
			),
		},
	};
}

/**
 * 3. Register: Derive keys and submit registration payload
 *    Returns 204 — do not call .json()
 */
export async function register(
	email: string,
	password: string,
	name?: string,
	hint?: string,
	iterations = 600_000,
	inviteCode?: string,
	adminPassword?: string,
	captchaResponse?: string,
): Promise<void> {
	const masterKey = await deriveMasterKey(password, email, iterations);
	const masterPasswordHash = await deriveMasterPasswordHash(
		masterKey,
		password,
	);

	const encKey = await hkdfExpand(new Uint8Array(masterKey), "enc", 32);
	const macKey = await hkdfExpand(new Uint8Array(masterKey), "mac", 32);
	const sym = crypto.getRandomValues(new Uint8Array(64));
	const protectedKey = await encryptBw(sym, encKey, macKey);

	const keyPair = await crypto.subtle.generateKey(
		{
			name: "RSA-OAEP",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-1",
		},
		true,
		["encrypt", "decrypt"],
	);

	const publicKey = new Uint8Array(
		await crypto.subtle.exportKey("spki", keyPair.publicKey),
	);
	const privateKey = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
	);
	const encryptedPrivateKey = await encryptBw(
		privateKey,
		sym.slice(0, 32),
		sym.slice(32, 64),
	);

	const payload: RegisterPayload = {
		email: email.toLowerCase().trim(),
		masterPasswordHash,
		masterPasswordHint: hint || undefined,
		key: protectedKey,
		kdf: KdfType.Pbkdf2,
		kdfIterations: iterations,
		name: name || undefined,
		inviteCode: inviteCode?.trim() || undefined,
		adminPassword: adminPassword || undefined,
		captchaResponse: captchaResponse || undefined,
		keys: {
			publicKey: bytesToBase64(publicKey),
			encryptedPrivateKey,
		},
	};

	rpcVoid(await rpc.api.accounts.register.$post({ json: payload }));
}
