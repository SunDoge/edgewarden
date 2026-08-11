import {
	deriveMasterKey,
	deriveMasterPasswordHash,
	hkdfExpand,
	encryptBw,
	rewrapUserKeyForMasterPassword,
	bytesToBase64,
	base64ToBytes,
} from "./crypto";
import {
	type PreloginResponse,
	type RegisterPayload,
	type TokenResponse,
	type SyncResponse,
	type DomainRulesResponse,
	type CustomEquivalentDomain,
	type CipherResponse,
	KdfType,
} from "@edgewarden/shared";
import type { InferRequestType } from "hono/client";
import { rpc, rpcJson } from "./rpc";
import { ApiError } from "./rpc";
import {
	assertAccountPasskey,
	unlockVaultKeyWithAccountPasskeyPrf,
} from "./passkeys";
import {
	browserDeviceName,
	getOrCreateDeviceIdentifier,
	WEB_DEVICE_TYPE,
} from "./client-device";

// Re-export shared types that consumers of this module may need
export type { PreloginResponse, RegisterPayload, TokenResponse, SyncResponse };
export { KdfType };

// ── Auth helpers ──────────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
	if (typeof window === "undefined") return null;
	return localStorage.getItem("access_token");
}

export function isLoggedIn(): boolean {
	return !!getAccessToken();
}

export async function logout(): Promise<void> {
	if (typeof window === "undefined") return;
	const refreshToken = localStorage.getItem("refresh_token");
	localStorage.removeItem("access_token");
	localStorage.removeItem("refresh_token");
	sessionStorage.removeItem("master_key");
	if (refreshToken) {
		try {
			await rpc.identity.connect.revocation.$post({
				form: { token: refreshToken },
			});
		} catch {
			// Local logout must still complete while offline.
		}
	}
}

type CreateCipherPayload = InferRequestType<
	typeof rpc.api.ciphers.$post
>["json"];
type UpdateCipherPayload = InferRequestType<
	(typeof rpc.api.ciphers)[":id"]["$put"]
>["json"];
type CreateSendPayload = InferRequestType<typeof rpc.api.sends.$post>["json"];
type CreateFileSendPayload = InferRequestType<
	typeof rpc.api.sends.file.v2.$post
>["json"];
type UpdateSendPayload = InferRequestType<
	(typeof rpc.api.sends)[":id"]["$put"]
>["json"];
type ImportCiphersPayload = InferRequestType<
	typeof rpc.api.ciphers.import.$post
>["json"];
type UpdateProfilePayload = InferRequestType<
	typeof rpc.api.accounts.profile.$put
>["json"];
type ChangePasswordPayload = InferRequestType<
	typeof rpc.api.accounts.password.$post
>["json"];

// ── API functions ─────────────────────────────────────────────────────────────

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
	await rpcJson(
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

	localStorage.setItem("access_token", tokenResponse.access_token);
	if (tokenResponse.refresh_token)
		localStorage.setItem("refresh_token", tokenResponse.refresh_token);

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
}

export type AdminRegistrationPolicy = Pick<
	RegistrationConfig,
	"signupsAllowed" | "invitationsAllowed"
>;

export async function getRegistrationConfigApi(): Promise<RegistrationConfig> {
	const response = await fetch("/api/config", {
		headers: { accept: "application/json" },
	});
	if (!response.ok) throw new Error("无法加载注册配置");
	const config = (await response.json()) as {
		registration?: Partial<RegistrationConfig>;
	};
	return {
		signupsAllowed: config.registration?.signupsAllowed === true,
		invitationsAllowed: config.registration?.invitationsAllowed === true,
		bootstrapRequired: config.registration?.bootstrapRequired === true,
		adminPasswordConfigured:
			config.registration?.adminPasswordConfigured === true,
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

export async function getTwoFactorPasskeysApi(
	masterPasswordHash: string,
): Promise<any> {
	return rpcJson(
		await rpc.api["two-factor"]["get-webauthn"].$post({
			json: { masterPasswordHash },
		}),
	);
}

export async function getTwoFactorPasskeyChallengeApi(
	masterPasswordHash: string,
): Promise<{ options: unknown; token: string }> {
	return rpcJson(
		await rpc.api["two-factor"]["get-webauthn-challenge"].$post({
			json: { masterPasswordHash },
		}),
	) as Promise<{ options: unknown; token: string }>;
}

export async function createTwoFactorPasskeyApi(payload: {
	masterPasswordHash: string;
	name: string;
	token: string;
	deviceResponse: unknown;
}): Promise<any> {
	return rpcJson(await rpc.api["two-factor"].webauthn.$put({ json: payload }));
}

export async function deleteTwoFactorPasskeyApi(payload: {
	masterPasswordHash: string;
	id: string;
}): Promise<any> {
	return rpcJson(
		await rpc.api["two-factor"].webauthn.$delete({ json: payload }),
	);
}

export async function getYubikeySettingsApi(
	masterPasswordHash: string,
): Promise<any> {
	return rpcJson(
		await rpc.api["yubico-enrollment"].settings.$post({
			json: { masterPasswordHash },
		}),
	);
}

export async function saveYubikeysApi(payload: {
	masterPasswordHash: string;
	otps: string[];
	nfc: boolean;
}): Promise<any> {
	return rpcJson(
		await rpc.api["yubico-enrollment"].save.$post({ json: payload }),
	);
}

export async function disableYubikeysApi(
	masterPasswordHash: string,
): Promise<any> {
	return rpcJson(
		await rpc.api["yubico-control"].disable.$post({
			json: { masterPasswordHash },
		}),
	);
}

export async function saveYubicoConfigApi(payload: {
	masterPasswordHash: string;
	clientId: string;
	secretKey: string;
}): Promise<any> {
	return rpcJson(
		await rpc.api["yubico-control"].config.$put({ json: payload }),
	);
}

export async function listOrganizationsApi(): Promise<any> {
	return rpcJson(await rpc.api.organizations.$get());
}

export async function createOrganizationApi(payload: {
	name: string;
	collectionName: string;
	key: string;
	publicKey: string;
	encryptedPrivateKey: string;
}): Promise<any> {
	return rpcJson(await rpc.api.organizations.$post({ json: payload }));
}

export async function updateOrganizationApi(
	orgId: string,
	name: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].$put({
			param: { orgId },
			json: { name },
		}),
	);
}

export async function deleteOrganizationApi(
	orgId: string,
	masterPasswordHash: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.organizations[":orgId"].$delete({
			param: { orgId },
			json: { masterPasswordHash },
		}),
	);
}

export async function getOrganizationInviteeApi(
	orgId: string,
	email: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].invitee.$get({
			param: { orgId },
			query: { email },
		}),
	);
}

export async function listOrganizationMembersApi(orgId: string): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].members.$get({ param: { orgId } }),
	);
}

export async function inviteOrganizationMemberApi(
	orgId: string,
	payload: {
		email: string;
		role: "admin" | "manager" | "member";
		accessAll: boolean;
		collections: Array<{
			id: string;
			readOnly: boolean;
			hidePasswords: boolean;
		}>;
		key: string;
	},
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].members.$post({
			param: { orgId },
			json: payload,
		}),
	);
}

export async function updateOrganizationMemberApi(
	orgId: string,
	memberId: string,
	payload: {
		role: "admin" | "manager" | "member";
		accessAll: boolean;
		collections: Array<{
			id: string;
			readOnly: boolean;
			hidePasswords: boolean;
		}>;
	},
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].members[":memberId"].$put({
			param: { orgId, memberId },
			json: payload,
		}),
	);
}

export async function removeOrganizationMemberApi(
	orgId: string,
	memberId: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.organizations[":orgId"].members[":memberId"].$delete({
			param: { orgId, memberId },
		}),
	);
}

export async function listOrganizationCollectionsApi(
	orgId: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].collections.$get({
			param: { orgId },
		}),
	);
}

export async function createOrganizationCollectionApi(
	orgId: string,
	name: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].collections.$post({
			param: { orgId },
			json: { name },
		}),
	);
}

export async function updateOrganizationCollectionApi(
	orgId: string,
	collectionId: string,
	name: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].collections[":collectionId"].$put({
			param: { orgId, collectionId },
			json: { name },
		}),
	);
}

export async function deleteOrganizationCollectionApi(
	orgId: string,
	collectionId: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.organizations[":orgId"].collections[":collectionId"].$delete({
			param: { orgId, collectionId },
		}),
	);
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
	localStorage.setItem("access_token", token.access_token);
	if (token.refresh_token)
		localStorage.setItem("refresh_token", token.refresh_token);
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
		keys: {
			publicKey: bytesToBase64(publicKey),
			encryptedPrivateKey,
		},
	};

	await rpcJson(await rpc.api.accounts.register.$post({ json: payload }));
}

/**
 * 4. Sync vault: Fetch all vault data
 */
export async function syncVault(): Promise<SyncResponse> {
	const response = await rpc.api.sync.$get();
	return rpcJson(response) as Promise<SyncResponse>;
}

export async function fetchRevisionDateApi(): Promise<number> {
	const revision = await rpcJson(
		await rpc.api.accounts["revision-date"].$get(),
	);
	const value = Number(revision);
	if (!Number.isFinite(value)) throw new Error("Invalid vault revision date");
	return value;
}

export async function createRealtimeTicketApi(): Promise<{
	token: string;
	expiresIn: number;
}> {
	return rpcJson(await rpc.api.notifications.token.$post()) as Promise<{
		token: string;
		expiresIn: number;
	}>;
}

/**
 * 5. Fetch domain settings
 */
export async function fetchDomainRules(): Promise<DomainRulesResponse> {
	const response = await rpc.api.settings.domains.$get();
	return rpcJson(response) as Promise<DomainRulesResponse>;
}

/**
 * 6. Update domain settings
 */
export async function updateDomainRules(
	customEquivalentDomains: CustomEquivalentDomain[],
	excludedGlobalEquivalentDomains: number[],
): Promise<DomainRulesResponse> {
	const response = await rpc.api.settings.domains.$put({
		json: { customEquivalentDomains, excludedGlobalEquivalentDomains },
	});
	return rpcJson(response) as Promise<DomainRulesResponse>;
}

/**
 * 7. Create a vault item (cipher)
 */
export async function createCipherApi(
	payload: CreateCipherPayload,
): Promise<CipherResponse> {
	const response = await rpc.api.ciphers.$post({ json: payload });
	return rpcJson(response) as Promise<CipherResponse>;
}

/**
 * 8. Update a vault item (cipher)
 */
export async function updateCipherApi(
	id: string,
	payload: UpdateCipherPayload,
): Promise<CipherResponse> {
	const response = await rpc.api.ciphers[":id"].$put({
		param: { id },
		json: payload,
	});
	return rpcJson(response) as Promise<CipherResponse>;
}

/**
 * 9. Delete a vault item (cipher)
 */
export async function deleteCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].delete.$put({ param: { id } }));
}

export async function restoreCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].restore.$put({ param: { id } }));
}

export async function archiveCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].archive.$put({ param: { id } }));
}

export async function unarchiveCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].unarchive.$put({ param: { id } }));
}

export async function hardDeleteCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].$delete({ param: { id } }));
}

export async function deleteCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.ciphers.delete.$put({ json: { ids } }));
}

export async function restoreCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.ciphers.restore.$post({ json: { ids } }));
}

export async function archiveCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.ciphers.archive.$put({ json: { ids } }));
}

export async function unarchiveCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.ciphers.unarchive.$put({ json: { ids } }));
}

export async function hardDeleteCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(
		await rpc.api.ciphers["delete-permanent"].$post({ json: { ids } }),
	);
}

export async function createAttachmentApi(
	cipherId: string,
	payload: { fileName: string; key: string; fileSize: number },
): Promise<{ attachmentId: string; url: string }> {
	return rpcJson(
		await rpc.api.ciphers[":id"].attachment.v2.$post({
			param: { id: cipherId },
			json: payload,
		}),
	) as Promise<{ attachmentId: string; url: string }>;
}

export async function uploadAttachmentApi(
	url: string,
	encryptedData: Uint8Array,
): Promise<void> {
	const response = await fetch(url, {
		method: "PUT",
		headers: { "Content-Type": "application/octet-stream" },
		body: encryptedData as BodyInit,
	});
	if (!response.ok)
		throw new ApiError(
			`附件上传失败 (${response.status})`,
			response.status,
			await response.text().catch(() => null),
		);
}

export async function downloadAttachmentApi(
	cipherId: string,
	attachmentId: string,
): Promise<Uint8Array> {
	const response = await rpc.api.ciphers[":id"].attachment[
		":attachmentId"
	].$get({ param: { id: cipherId, attachmentId } });
	if (!response.ok)
		throw new ApiError(
			`附件下载失败 (${response.status})`,
			response.status,
			await response.text().catch(() => null),
		);
	return new Uint8Array(await response.arrayBuffer());
}

export async function deleteAttachmentApi(
	cipherId: string,
	attachmentId: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.ciphers[":id"].attachment[":attachmentId"].$delete({
			param: { id: cipherId, attachmentId },
		}),
	);
}

/**
 * 10. Fetch all sends for the user
 */
export async function fetchSendsApi(): Promise<{ data: any[] }> {
	const response = await rpc.api.sends.$get();
	return rpcJson(response);
}

/**
 * 11. Create a send
 */
export async function createSendApi(payload: CreateSendPayload): Promise<any> {
	const response = await rpc.api.sends.$post({ json: payload });
	return rpcJson(response);
}

/**
 * 12. Create a file send v2
 */
export async function createFileSendApi(
	payload: CreateFileSendPayload,
): Promise<any> {
	const response = await rpc.api.sends.file.v2.$post({ json: payload });
	return rpcJson(response);
}

/**
 * 13. Update a send
 */
export async function updateSendApi(
	id: string,
	payload: UpdateSendPayload,
): Promise<any> {
	const response = await rpc.api.sends[":id"].$put({
		param: { id },
		json: payload,
	});
	return rpcJson(response);
}

/**
 * 14. Delete a send
 */
export async function deleteSendApi(id: string): Promise<void> {
	await rpc.api.sends[":id"].$delete({ param: { id } });
}

export async function deleteSendsApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.sends.delete.$post({ json: { ids } }));
}

/**
 * 15. Remove send password
 */
export async function removeSendPasswordApi(id: string): Promise<any> {
	const response = await rpc.api.sends[":id"]["remove-password"].$post({
		param: { id },
	});
	return rpcJson(response);
}

/**
 * 16. Access a send publicly
 */
export async function accessSendPublicApi(
	accessId: string,
	payload?: { password?: string },
): Promise<any> {
	const response = await rpc.api.sends.access[":idOrAccessId"].$post({
		param: { idOrAccessId: accessId },
		json: payload ?? {},
	});
	return rpcJson(response);
}

export async function requestSendFileDownloadApi(
	sendId: string,
	fileId: string,
	payload: { password?: string },
): Promise<{ url: string }> {
	const response = await rpc.api.sends[":idOrAccessId"].access.file[
		":fileId"
	].$post({
		param: { idOrAccessId: sendId, fileId },
		json: payload,
	});
	return rpcJson(response) as Promise<{ url: string }>;
}

// ── Backup APIs ─────────────────────────────────────────────────────────────

export async function fetchBackupSettingsApi(): Promise<any> {
	const response = await rpc.api.admin.backup.settings.$get();
	return rpcJson(response);
}

export async function updateBackupSettingsApi(settings: any): Promise<any> {
	const response = await rpc.api.admin.backup.settings.$put({ json: settings });
	return rpcJson(response);
}

export async function runBackupApi(
	destinationId?: string | null,
): Promise<any> {
	const response = await rpc.api.admin.backup.run.$post({
		json: { destinationId: destinationId ?? undefined },
	});
	return rpcJson(response);
}

export async function listRemoteBackupsApi(
	destinationId: string,
	path: string,
): Promise<any> {
	const response = await rpc.api.admin.backup.remote.$get({
		query: { destinationId, path },
	});
	return rpcJson(response);
}

export async function downloadRemoteBackupApi(
	destinationId: string,
	path: string,
): Promise<Blob> {
	const response = await rpc.api.admin.backup.remote.download.$get({
		query: { destinationId, path },
	});
	return response.blob();
}

export async function inspectRemoteBackupApi(
	destinationId: string,
	path: string,
): Promise<any> {
	const response = await rpc.api.admin.backup.remote.integrity.$get({
		query: { destinationId, path },
	});
	return rpcJson(response);
}

export async function deleteRemoteBackupApi(
	destinationId: string,
	path: string,
): Promise<void> {
	await rpc.api.admin.backup.remote.file.$delete({
		query: { destinationId, path },
	});
}

export async function restoreRemoteBackupApi(
	destinationId: string,
	path: string,
	replaceExisting: boolean,
	allowChecksumMismatch: boolean,
): Promise<any> {
	const response = await rpc.api.admin.backup.remote.restore.$post({
		json: { destinationId, path, replaceExisting, allowChecksumMismatch },
	});
	return rpcJson(response);
}

export async function importBackupLocalApi(
	file: File,
	replaceExisting: boolean,
	allowChecksumMismatch: boolean,
): Promise<any> {
	const response = await rpc.api.admin.backup.import.$post({
		form: {
			file,
			replaceExisting: replaceExisting ? "1" : "0",
			allowChecksumMismatch: allowChecksumMismatch ? "1" : "0",
		},
	});
	return rpcJson(response);
}

export async function exportBackupLocalApi(
	includeAttachments: boolean,
): Promise<Blob> {
	const response = await rpc.api.admin.backup.export.$post({
		json: { includeAttachments },
	});
	return response.blob();
}

/**
 * Import ciphers/folders in bulk (client-side encrypted)
 */
export async function importCiphersApi(
	payload: ImportCiphersPayload,
): Promise<void> {
	await rpc.api.ciphers.import.$post({ json: payload });
}

/**
 * Create an individual folder (client-side encrypted name)
 */
export async function createFolderApi(payload: { name: string }): Promise<any> {
	const response = await rpc.api.folders.$post({ json: payload });
	return rpcJson(response);
}

/**
 * Update an individual folder's name (client-side encrypted)
 */
export async function updateFolderApi(
	id: string,
	payload: { name: string },
): Promise<any> {
	const response = await rpc.api.folders[":id"].$put({
		param: { id },
		json: payload,
	});
	return rpcJson(response);
}

/**
 * Delete an individual folder
 */
export async function deleteFolderApi(id: string): Promise<void> {
	await rpc.api.folders[":id"].$delete({ param: { id } });
}

export async function deleteFoldersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.folders.delete.$post({ json: { ids } }));
}

// ── Account and security APIs ──────────────────────────────────────────────

export async function fetchProfileApi(): Promise<any> {
	return rpcJson(await rpc.api.accounts.profile.$get());
}

export async function updateProfileApi(
	payload: UpdateProfilePayload,
): Promise<any> {
	return rpcJson(await rpc.api.accounts.profile.$put({ json: payload }));
}

export async function changePasswordApi(
	payload: ChangePasswordPayload,
): Promise<void> {
	await rpcJson(await rpc.api.accounts.password.$post({ json: payload }));
}

export async function changeMasterPasswordApi(args: {
	email: string;
	currentPassword: string;
	newPassword: string;
	iterations: number;
	profileKey: string;
	masterPasswordHint?: string | null;
}): Promise<void> {
	const wrapped = await rewrapUserKeyForMasterPassword(args);

	await changePasswordApi({
		masterPasswordHash: wrapped.currentMasterPasswordHash,
		newMasterPasswordHash: wrapped.newMasterPasswordHash,
		key: wrapped.protectedUserKey,
		masterPasswordHint: args.masterPasswordHint,
	});
}

export async function fetchApiKeyApi(): Promise<{ apiKey: string }> {
	return rpcJson(await rpc.api.accounts["api-key"].$get());
}

export async function rotateApiKeyApi(): Promise<{ apiKey: string }> {
	return rpcJson(await rpc.api.accounts["rotate-api-key"].$post());
}

export async function fetchDevicesApi(): Promise<{ data: any[] }> {
	return rpcJson(await rpc.api.devices.$get());
}

export async function renameDeviceApi(id: string, name: string): Promise<any> {
	return rpcJson(
		await rpc.api.devices[":id"].name.$put({ param: { id }, json: { name } }),
	);
}

export async function deleteDeviceApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.devices[":id"].$delete({ param: { id } }));
}

export async function deleteDevicesApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.devices.delete.$post({ json: { ids } }));
}

export async function deleteAllDevicesApi(
	masterPasswordHash: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.devices.$delete({ json: { masterPasswordHash } }),
	);
}

export async function deleteAccountApi(
	masterPasswordHash: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.accounts.delete.$post({ json: { masterPasswordHash } }),
	);
}

export async function fetchTwoFactorApi(): Promise<{ data: any[] }> {
	return rpcJson(await rpc.api["two-factor"].$get());
}

export async function getAuthenticatorApi(): Promise<{
	key: string;
	enabled: boolean;
}> {
	return rpcJson(await rpc.api["two-factor"]["get-authenticator"].$post());
}

export async function enableAuthenticatorApi(
	key: string,
	token: string,
): Promise<any> {
	return rpcJson(
		await rpc.api["two-factor"].authenticator.$put({ json: { key, token } }),
	);
}

export async function disableTwoFactorApi(
	masterPasswordHash: string,
): Promise<void> {
	await rpcJson(
		await rpc.api["two-factor"].disable.$post({
			json: { masterPasswordHash },
		}),
	);
}

export async function fetchRecoveryCodeApi(): Promise<{ code: string | null }> {
	return rpcJson(await rpc.api["two-factor"]["get-recover"].$post());
}

export async function listAccountPasskeysApi(): Promise<{ data: any[] }> {
	return rpcJson(await rpc.api.webauthn.$get()) as Promise<{ data: any[] }>;
}

export async function getAccountPasskeyAttestationOptionsApi(
	masterPasswordHash: string,
): Promise<{ options: unknown; token: string }> {
	return rpcJson(
		await rpc.api.webauthn["attestation-options"].$post({
			json: { masterPasswordHash },
		}),
	) as Promise<{ options: unknown; token: string }>;
}

export async function getAccountPasskeyAssertionOptionsApi(
	masterPasswordHash: string,
	credentialId: string,
): Promise<{ options: unknown; token: string }> {
	return rpcJson(
		await rpc.api.webauthn["assertion-options"].$post({
			json: { masterPasswordHash, credentialId },
		}),
	) as Promise<{ options: unknown; token: string }>;
}

export async function createAccountPasskeyApi(payload: {
	token: string;
	deviceResponse: unknown;
	name?: string;
	supportsPrf?: boolean;
	encryptedUserKey?: string;
	encryptedPublicKey?: string;
	encryptedPrivateKey?: string;
}): Promise<any> {
	return rpcJson(await rpc.api.webauthn.$post({ json: payload }));
}

export async function updateAccountPasskeyEncryptionApi(payload: {
	token: string;
	deviceResponse: unknown;
	encryptedUserKey: string;
	encryptedPublicKey: string;
	encryptedPrivateKey: string;
}): Promise<any> {
	return rpcJson(await rpc.api.webauthn.$put({ json: payload }));
}

export async function deleteAccountPasskeyApi(
	id: string,
	masterPasswordHash: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.webauthn[":id"].delete.$post({
			param: { id },
			json: { masterPasswordHash },
		}),
	);
}

export async function listAdminUsersApi(): Promise<{ data: any[] }> {
	return rpcJson(await rpc.api.admin.users.$get()) as Promise<{ data: any[] }>;
}

export async function getAdminRegistrationPolicyApi(): Promise<AdminRegistrationPolicy> {
	return rpcJson(await rpc.api.admin.registration.$get());
}

export async function updateAdminRegistrationPolicyApi(
	masterPasswordHash: string,
	signupsAllowed: boolean,
	invitationsAllowed: boolean,
): Promise<AdminRegistrationPolicy> {
	return rpcJson(
		await rpc.api.admin.registration.$put({
			json: { masterPasswordHash, signupsAllowed, invitationsAllowed },
		}),
	) as Promise<AdminRegistrationPolicy>;
}

export async function listAdminInvitesApi(
	includeInactive = true,
): Promise<{ data: any[] }> {
	return rpcJson(
		await rpc.api.admin.invites.$get({
			query: { includeInactive: String(includeInactive) },
		}),
	) as Promise<{ data: any[] }>;
}

export async function createAdminInviteApi(
	masterPasswordHash: string,
	expiresInHours: number,
): Promise<any> {
	return rpcJson(
		await rpc.api.admin.invites.$post({
			json: { masterPasswordHash, expiresInHours },
		}),
	);
}

export async function deleteAdminInviteApi(
	code: string,
	masterPasswordHash: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.admin.invites[":code"].$delete({
			param: { code },
			json: { masterPasswordHash },
		}),
	);
}

export async function deleteAdminInvitesApi(
	masterPasswordHash: string,
	invalidOnly = false,
): Promise<{ deleted: number }> {
	return rpcJson(
		await rpc.api.admin.invites.$delete({
			query: invalidOnly ? { scope: "invalid" } : {},
			json: { masterPasswordHash },
		}),
	) as Promise<{ deleted: number }>;
}

export async function setAdminUserStatusApi(
	id: string,
	status: "active" | "banned",
	masterPasswordHash: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.admin.users[":id"].status.$put({
			param: { id },
			json: { status, masterPasswordHash },
		}),
	);
}

export async function deleteAdminUserApi(
	id: string,
	masterPasswordHash: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.admin.users[":id"].$delete({
			param: { id },
			json: { masterPasswordHash },
		}),
	);
}

export interface AuditLogQuery {
	limit?: number;
	offset?: number;
	category?: string;
	level?: string;
	q?: string;
}
export async function listAuditLogsApi(filters: AuditLogQuery = {}): Promise<{
	data: any[];
	total: number;
	limit: number;
	offset: number;
	hasMore: boolean;
}> {
	const query: Record<string, string> = {};
	for (const [key, value] of Object.entries(filters))
		if (value !== undefined && value !== "") query[key] = String(value);
	return rpcJson(await rpc.api.admin.logs.$get({ query })) as Promise<{
		data: any[];
		total: number;
		limit: number;
		offset: number;
		hasMore: boolean;
	}>;
}

export async function clearAuditLogsApi(
	masterPasswordHash: string,
): Promise<{ deleted: number }> {
	return rpcJson(
		await rpc.api.admin.logs.$delete({ json: { masterPasswordHash } }),
	) as Promise<{ deleted: number }>;
}

export async function fetchAuditLogSettingsApi(): Promise<{
	retentionDays: number | null;
	maxEntries: number | null;
}> {
	return rpcJson(await rpc.api.admin.logs.settings.$get()) as Promise<{
		retentionDays: number | null;
		maxEntries: number | null;
	}>;
}

export async function updateAuditLogSettingsApi(settings: {
	retentionDays: 7 | 30 | 90 | 180 | 365 | null;
	maxEntries: number | null;
}): Promise<{ retentionDays: number | null; maxEntries: number | null }> {
	return rpcJson(
		await rpc.api.admin.logs.settings.$put({ json: settings }),
	) as Promise<{ retentionDays: number | null; maxEntries: number | null }>;
}
