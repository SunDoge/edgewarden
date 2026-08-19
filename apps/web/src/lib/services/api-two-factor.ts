import { rpc, rpcJson } from "./rpc";
import type {
	TwoFactorPasskeySettings,
	YubicoConfigResult,
	YubikeySettingsResult,
} from "./two-factor-types";

export async function getTwoFactorPasskeysApi(
	masterPasswordHash: string,
): Promise<TwoFactorPasskeySettings> {
	return (await rpcJson(
		await rpc.api["two-factor"]["get-webauthn"].$post({
			json: { masterPasswordHash },
		}),
	)) as TwoFactorPasskeySettings;
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
}): Promise<TwoFactorPasskeySettings> {
	return (await rpcJson(
		await rpc.api["two-factor"].webauthn.$put({ json: payload }),
	)) as TwoFactorPasskeySettings;
}

export async function deleteTwoFactorPasskeyApi(payload: {
	masterPasswordHash: string;
	id: string;
}): Promise<TwoFactorPasskeySettings> {
	return (await rpcJson(
		await rpc.api["two-factor"].webauthn.$delete({ json: payload }),
	)) as TwoFactorPasskeySettings;
}

export async function getYubikeySettingsApi(
	masterPasswordHash: string,
): Promise<YubikeySettingsResult> {
	return (await rpcJson(
		await rpc.api["yubico-enrollment"].settings.$post({
			json: { masterPasswordHash },
		}),
	)) as YubikeySettingsResult;
}

export async function saveYubikeysApi(payload: {
	masterPasswordHash: string;
	otps: string[];
	nfc: boolean;
}): Promise<YubikeySettingsResult> {
	return (await rpcJson(
		await rpc.api["yubico-enrollment"].save.$post({ json: payload }),
	)) as YubikeySettingsResult;
}

export async function disableYubikeysApi(
	masterPasswordHash: string,
): Promise<YubikeySettingsResult> {
	return (await rpcJson(
		await rpc.api["yubico-control"].disable.$post({
			json: { masterPasswordHash },
		}),
	)) as YubikeySettingsResult;
}

export async function saveYubicoConfigApi(payload: {
	masterPasswordHash: string;
	clientId: string;
	secretKey: string;
}): Promise<YubicoConfigResult> {
	return (await rpcJson(
		await rpc.api["yubico-control"].config.$put({ json: payload }),
	)) as YubicoConfigResult;
}
