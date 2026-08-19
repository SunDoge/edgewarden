import type { InferRequestType } from "hono/client";
import { rpc, rpcJson, rpcVoid } from "./rpc";
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
	rpcVoid(await rpc.api.sends.delete.$post({ json: { ids } }));
}

/**
 * 15. Remove send password
 */
export async function removeSendPasswordApi(id: string) {
	const response = await rpc.api.sends[":id"]["remove-password"].$post({
		param: { id },
	});
	return (await rpcJson(response)) as OwnedSend;
}

/**
 * 16. Access a send publicly
 */
export async function accessSendPublicApi(
	accessId: string,
	payload?: { password?: string },
): Promise<PublicSend> {
	const response = await rpc.api.sends.access[":idOrAccessId"].$post({
		param: { idOrAccessId: accessId },
		json: payload ?? {},
	});
	return (await rpcJson(response)) as PublicSend;
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
