import type { InferRequestType } from "hono/client";
import { rewrapUserKeyForMasterPassword } from "./crypto";
import { rpc, rpcJson, rpcVoid } from "./rpc";

type UpdateProfilePayload = InferRequestType<
	typeof rpc.api.accounts.profile.$put
>["json"];
type ChangePasswordPayload = InferRequestType<
	typeof rpc.api.accounts.password.$post
>["json"];

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
	rpcVoid(await rpc.api.accounts.password.$post({ json: payload }));
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
	return rpcJson(await rpc.api.accounts["api-key"].$get()) as Promise<{
		apiKey: string;
	}>;
}

export async function rotateApiKeyApi(): Promise<{ apiKey: string }> {
	return rpcJson(await rpc.api.accounts["rotate-api-key"].$post()) as Promise<{
		apiKey: string;
	}>;
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
	rpcVoid(await rpc.api.devices[":id"].$delete({ param: { id } }));
}

export async function deleteDevicesApi(ids: string[]): Promise<void> {
	rpcVoid(await rpc.api.devices.delete.$post({ json: { ids } }));
}

export async function deleteAllDevicesApi(
	masterPasswordHash: string,
): Promise<void> {
	rpcVoid(
		await rpc.api.devices.$delete({ json: { masterPasswordHash } }),
	);
}

export async function deleteAccountApi(
	masterPasswordHash: string,
): Promise<void> {
	rpcVoid(
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
	return rpcJson(
		await rpc.api["two-factor"]["get-authenticator"].$post(),
	) as Promise<{ key: string; enabled: boolean }>;
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
	rpcVoid(
		await rpc.api["two-factor"].disable.$post({
			json: { masterPasswordHash },
		}),
	);
}

export async function fetchRecoveryCodeApi(): Promise<{ code: string | null }> {
	return rpcJson(
		await rpc.api["two-factor"]["get-recover"].$post(),
	) as Promise<{ code: string | null }>;
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
	rpcVoid(
		await rpc.api.webauthn[":id"].delete.$post({
			param: { id },
			json: { masterPasswordHash },
		}),
	);
}
