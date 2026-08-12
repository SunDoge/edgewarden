import type { InferRequestType } from "hono/client";
import { rpc, rpcJson } from "./rpc";

type CreateSendPayload = InferRequestType<typeof rpc.api.sends.$post>["json"];
type CreateFileSendPayload = InferRequestType<
	typeof rpc.api.sends.file.v2.$post
>["json"];
type UpdateSendPayload = InferRequestType<
	(typeof rpc.api.sends)[":id"]["$put"]
>["json"];

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
