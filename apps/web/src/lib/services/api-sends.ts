import type { InferRequestType } from "hono/client";
import { ApiError, rpc, rpcJson, rpcVoid } from "./rpc";
import type {
  FileSendUpload,
  OwnedSend,
  PublicSend,
  SendMutationPayload,
} from "./send-types";

type CreateFileSendPayload = InferRequestType<
  typeof rpc.api.sends.file.v2.$post
>["json"];
type UpdateSendPayload = InferRequestType<
  (typeof rpc.api.sends)[":id"]["$put"]
>["json"];

export async function fetchSendsApi(): Promise<{ data: OwnedSend[] }> {
  const response = await rpc.api.sends.$get();
  return (await rpcJson(response)) as { data: OwnedSend[] };
}
/**
 * 11. Create a send
 */
export async function createSendApi(payload: SendMutationPayload) {
  const response = await rpc.api.sends.$post({
    json: payload as InferRequestType<typeof rpc.api.sends.$post>["json"],
  });
  return (await rpcJson(response)) as OwnedSend;
}
/**
 * 12. Create a file send v2
 */
export async function createFileSendApi(payload: SendMutationPayload) {
  const response = await rpc.api.sends.file.v2.$post({
    json: payload as CreateFileSendPayload,
  });
  return (await rpcJson(response)) as FileSendUpload;
}

/**
 * 13. Update a send
 */
export async function updateSendApi(id: string, payload: SendMutationPayload) {
  const response = await rpc.api.sends[":id"].$put({
    param: { id },
    json: payload as UpdateSendPayload,
  });
  return (await rpcJson(response)) as OwnedSend;
}

/**
 * 14. Delete a send
 */
export async function deleteSendApi(id: string): Promise<void> {
  rpcVoid(await rpc.api.sends[":id"].$delete({ param: { id } }));
}

export async function deleteSendsApi(ids: string[]): Promise<void> {
  rpcVoid(await rpc.api.edgewarden.sends.delete.$post({ json: { ids } }));
}

/**
 * 15. Remove send password
 */
export async function removeSendPasswordApi(id: string) {
  const response = await rpc.api.sends[":id"]["remove-password"].$put({
    param: { id },
  });
  return (await rpcJson(response)) as OwnedSend;
}

/**
 * 16. Access a send publicly
 */
export async function accessSendPublicApi(
  accessId: string,
  payload?: { passwordHash?: string },
): Promise<{ send: PublicSend; accessToken: string }> {
  const tokenResponse = await fetch("/identity/connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "send_access",
      client_id: "send",
      scope: "api.send.access",
      send_id: accessId,
      ...(payload?.passwordHash
        ? { password_hash_b64: payload.passwordHash }
        : {}),
    }),
  });
  const tokenPayload = (await tokenResponse.json().catch(() => null)) as {
    access_token?: string;
    error_description?: string;
    send_access_error_type?: string;
  } | null;
  if (!tokenResponse.ok || !tokenPayload?.access_token) {
    const passwordFailure = Boolean(tokenPayload?.send_access_error_type);
    throw new ApiError(
      tokenPayload?.error_description || "无法验证 Send 访问权限",
      passwordFailure ? 401 : tokenResponse.status,
      tokenPayload,
    );
  }

  const response = await fetch("/api/sends/access", {
    method: "POST",
    headers: { authorization: `Bearer ${tokenPayload.access_token}` },
  });
  if (!response.ok) {
    throw new ApiError("无法读取 Send", response.status, null);
  }
  return {
    send: (await response.json()) as PublicSend,
    accessToken: tokenPayload.access_token,
  };
}

export async function requestSendFileDownloadApi(
  accessToken: string,
  fileId: string,
): Promise<{ url: string }> {
  const response = await fetch(`/api/sends/access/file/${fileId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new ApiError("无法获取文件下载地址", response.status, null);
  }
  return response.json() as Promise<{ url: string }>;
}
