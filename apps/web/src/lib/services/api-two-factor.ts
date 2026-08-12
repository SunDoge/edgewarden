import { rpc, rpcJson } from "./rpc";

export async function getTwoFactorPasskeysApi(masterPasswordHash: string): Promise<any> {
	return rpcJson(await rpc.api["two-factor"]["get-webauthn"].$post({ json: { masterPasswordHash } }));
}

export async function getTwoFactorPasskeyChallengeApi(
	masterPasswordHash: string,
): Promise<{ options: unknown; token: string }> {
	return rpcJson(
		await rpc.api["two-factor"]["get-webauthn-challenge"].$post({ json: { masterPasswordHash } }),
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
	return rpcJson(await rpc.api["two-factor"].webauthn.$delete({ json: payload }));
}

export async function getYubikeySettingsApi(masterPasswordHash: string): Promise<any> {
	return rpcJson(await rpc.api["yubico-enrollment"].settings.$post({ json: { masterPasswordHash } }));
}

export async function saveYubikeysApi(payload: {
	masterPasswordHash: string;
	otps: string[];
	nfc: boolean;
}): Promise<any> {
	return rpcJson(await rpc.api["yubico-enrollment"].save.$post({ json: payload }));
}

export async function disableYubikeysApi(masterPasswordHash: string): Promise<any> {
	return rpcJson(await rpc.api["yubico-control"].disable.$post({ json: { masterPasswordHash } }));
}

export async function saveYubicoConfigApi(payload: {
	masterPasswordHash: string;
	clientId: string;
	secretKey: string;
}): Promise<any> {
	return rpcJson(await rpc.api["yubico-control"].config.$put({ json: payload }));
}
