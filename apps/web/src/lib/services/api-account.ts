import type { InferRequestType } from "hono/client";
import { rewrapUserKeyForMasterPassword } from "./crypto";
import { rpc, rpcJson, rpcVoid } from "./rpc";
import type {
  AccountDevice,
  AccountPasskey,
  AccountProfile,
  ApiList,
  TwoFactorProvider,
} from "./account-types";

type UpdateProfilePayload = InferRequestType<
  typeof rpc.api.accounts.profile.$put
>["json"];
type ChangePasswordPayload = InferRequestType<
  typeof rpc.api.accounts.password.$post
>["json"];

// ── Account and security APIs ──────────────────────────────────────────────

export async function fetchProfileApi(): Promise<AccountProfile> {
  return (await rpcJson(
    await rpc.api.accounts.profile.$get(),
  )) as AccountProfile;
}

export async function updateProfileApi(
  payload: UpdateProfilePayload,
): Promise<AccountProfile> {
  return (await rpcJson(
    await rpc.api.accounts.profile.$put({ json: payload }),
  )) as AccountProfile;
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

export async function fetchDevicesApi(): Promise<ApiList<AccountDevice>> {
  return (await rpcJson(
    await rpc.api.devices.$get(),
  )) as ApiList<AccountDevice>;
}

export async function renameDeviceApi(
  id: string,
  name: string,
): Promise<AccountDevice> {
  return (await rpcJson(
    await rpc.api.devices[":id"].name.$put({ param: { id }, json: { name } }),
  )) as AccountDevice;
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
  rpcVoid(await rpc.api.devices.$delete({ json: { masterPasswordHash } }));
}

export async function deleteAccountApi(
  masterPasswordHash: string,
): Promise<void> {
  rpcVoid(
    await rpc.api.accounts.delete.$post({ json: { masterPasswordHash } }),
  );
}

export async function fetchTwoFactorApi(): Promise<ApiList<TwoFactorProvider>> {
  return (await rpcJson(
    await rpc.api["two-factor"].$get(),
  )) as ApiList<TwoFactorProvider>;
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
): Promise<TwoFactorProvider> {
  return (await rpcJson(
    await rpc.api["two-factor"].authenticator.$put({ json: { key, token } }),
  )) as TwoFactorProvider;
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

export async function listAccountPasskeysApi(): Promise<
  ApiList<AccountPasskey>
> {
  return (await rpcJson(
    await rpc.api.webauthn.$get(),
  )) as ApiList<AccountPasskey>;
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
}): Promise<AccountPasskey> {
  return (await rpcJson(
    await rpc.api.webauthn.$post({ json: payload }),
  )) as AccountPasskey;
}

export async function updateAccountPasskeyEncryptionApi(payload: {
  token: string;
  deviceResponse: unknown;
  encryptedUserKey: string;
  encryptedPublicKey: string;
  encryptedPrivateKey: string;
}): Promise<AccountPasskey> {
  return (await rpcJson(
    await rpc.api.webauthn.$put({ json: payload }),
  )) as AccountPasskey;
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
