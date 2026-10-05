import { rpc, rpcJson, rpcVoid } from "./rpc";
import type {
  TwoFactorPasskeyMutation,
  TwoFactorPasskeyVerification,
  YubicoConfigResult,
  YubikeySettingsMutation,
  YubikeySettingsVerification,
} from "./two-factor-types";

export async function getTwoFactorPasskeysApi(
  masterPasswordHash: string,
): Promise<TwoFactorPasskeyVerification> {
  return (await rpcJson(
    await rpc.api["two-factor"]["get-webauthn"].$post({
      json: { masterPasswordHash },
    }),
  )) as TwoFactorPasskeyVerification;
}

export async function getTwoFactorPasskeyChallengeApi(
  userVerificationToken: string,
): Promise<{ options: unknown; token: string }> {
  return rpcJson(
    await rpc.api["two-factor"]["get-webauthn-challenge"].$post({
      json: { userVerificationToken },
    }),
  ) as Promise<{ options: unknown; token: string }>;
}

export async function createTwoFactorPasskeyApi(payload: {
  id: number;
  userVerificationToken: string;
  name: string;
  token: string;
  deviceResponse: unknown;
}): Promise<TwoFactorPasskeyMutation> {
  return (await rpcJson(
    await rpc.api["two-factor"].webauthn.$put({ json: payload }),
  )) as TwoFactorPasskeyMutation;
}

export async function deleteTwoFactorPasskeyApi(payload: {
  userVerificationToken: string;
  id: number;
}): Promise<TwoFactorPasskeyMutation> {
  return (await rpcJson(
    await rpc.api["two-factor"].webauthn.$delete({ json: payload }),
  )) as TwoFactorPasskeyMutation;
}

export async function deleteAllTwoFactorPasskeysApi(
  userVerificationToken: string,
): Promise<void> {
  rpcVoid(
    await rpc.api["two-factor"].webauthn.all.$delete({
      json: { userVerificationToken },
    }),
  );
}

export async function getYubikeySettingsApi(
  masterPasswordHash: string,
): Promise<YubikeySettingsVerification> {
  return (await rpcJson(
    await rpc.api["two-factor"]["get-yubikey"].$post({
      json: { masterPasswordHash },
    }),
  )) as YubikeySettingsVerification;
}

export async function saveYubikeysApi(payload: {
  key1?: string;
  key2?: string;
  key3?: string;
  key4?: string;
  key5?: string;
  nfc: boolean;
  userVerificationToken: string;
}): Promise<YubikeySettingsMutation> {
  return (await rpcJson(
    await rpc.api["two-factor"].yubikey.$put({ json: payload }),
  )) as YubikeySettingsMutation;
}

export async function disableYubikeysApi(
  userVerificationToken: string,
): Promise<void> {
  rpcVoid(
    await rpc.api["two-factor"].yubikey.$delete({
      json: { userVerificationToken },
    }),
  );
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
