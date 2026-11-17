import { rpc, rpcJson, rpcVoid } from "./rpc";

export interface EmergencyAccessEntry {
  id: string;
  status: 1 | 2 | 3 | 4;
  type: 0 | 1;
  waitTimeDays: number;
  recoveryInitiatedDate: string | null;
  grantorId?: string;
  granteeId?: string;
  email: string;
  name: string | null;
}

export interface EmergencyAccessList {
  data: EmergencyAccessEntry[];
}

export const listTrustedEmergencyContactsApi = async () =>
  rpcJson(
    await rpc.api["emergency-access"].trusted.$get(),
  ) as Promise<EmergencyAccessList>;
export const listGrantedEmergencyAccessApi = async () =>
  rpcJson(
    await rpc.api["emergency-access"].granted.$get(),
  ) as Promise<EmergencyAccessList>;

export async function inviteEmergencyContactApi(
  email: string,
  type: 0 | 1,
  waitTimeDays: number,
) {
  rpcVoid(
    await rpc.api["emergency-access"].invite.$post({
      json: { email, type, waitTimeDays },
    }),
  );
}
export async function confirmEmergencyContactApi(id: string, key: string) {
  return rpcJson(
    await rpc.api["emergency-access"][":id"].confirm.$post({
      param: { id },
      json: { key },
    }),
  );
}
export async function initiateEmergencyAccessApi(id: string) {
  return rpcJson(
    await rpc.api["emergency-access"][":id"].initiate.$post({ param: { id } }),
  );
}
export async function approveEmergencyAccessApi(id: string) {
  return rpcJson(
    await rpc.api["emergency-access"][":id"].approve.$post({ param: { id } }),
  );
}
export async function rejectEmergencyAccessApi(id: string) {
  return rpcJson(
    await rpc.api["emergency-access"][":id"].reject.$post({ param: { id } }),
  );
}
export async function deleteEmergencyAccessApi(id: string) {
  rpcVoid(await rpc.api["emergency-access"][":id"].$delete({ param: { id } }));
}
export async function getUserPublicKeyApi(userId: string) {
  return rpcJson(
    await rpc.api.users[":userId"]["public-key"].$get({ param: { userId } }),
  ) as Promise<{ publicKey: string }>;
}
export async function viewEmergencyAccessApi(id: string) {
  return rpcJson(
    await rpc.api["emergency-access"][":id"].view.$post({ param: { id } }),
  ) as Promise<{
    ciphers: Array<Record<string, unknown>>;
    keyEncrypted: string;
  }>;
}
export async function takeoverEmergencyAccessApi(id: string) {
  return rpcJson(
    await rpc.api["emergency-access"][":id"].takeover.$post({ param: { id } }),
  ) as Promise<{
    kdf: number;
    kdfIterations: number;
    keyEncrypted: string;
    salt: string;
  }>;
}
export async function setEmergencyAccessPasswordApi(
  id: string,
  newMasterPasswordHash: string,
  key: string,
) {
  rpcVoid(
    await rpc.api["emergency-access"][":id"].password.$post({
      param: { id },
      json: { newMasterPasswordHash, key },
    }),
  );
}
