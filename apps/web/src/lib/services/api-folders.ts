import type { InferRequestType } from "hono/client";
import { rpc, rpcJson, rpcVoid } from "./rpc";

type ImportCiphersPayload = InferRequestType<
  typeof rpc.api.ciphers.import.$post
>["json"];

/**
 * Import ciphers/folders in bulk (client-side encrypted)
 */
export async function importCiphersApi(
  payload: ImportCiphersPayload,
): Promise<void> {
  rpcVoid(await rpc.api.ciphers.import.$post({ json: payload }));
}

/**
 * Create an individual folder (client-side encrypted name)
 */
export async function createFolderApi(payload: {
  name: string;
}): Promise<FolderResponse> {
  const response = await rpc.api.folders.$post({ json: payload });
  return (await rpcJson(response)) as FolderResponse;
}

/**
 * Update an individual folder's name (client-side encrypted)
 */
export async function updateFolderApi(
  id: string,
  payload: { name: string },
): Promise<FolderResponse> {
  const response = await rpc.api.folders[":id"].$put({
    param: { id },
    json: payload,
  });
  return (await rpcJson(response)) as FolderResponse;
}

/**
 * Delete an individual folder
 */
export async function deleteFolderApi(id: string): Promise<void> {
  rpcVoid(await rpc.api.folders[":id"].$delete({ param: { id } }));
}

export async function deleteFoldersApi(ids: string[]): Promise<void> {
  rpcVoid(await rpc.api.folders.delete.$post({ json: { ids } }));
}
import type { FolderResponse } from "@edgewarden/shared";
