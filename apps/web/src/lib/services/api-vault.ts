import type {
	CipherResponse,
	CustomEquivalentDomain,
	DomainRulesResponse,
	SyncResponse,
} from "@edgewarden/shared";
import type { InferRequestType } from "hono/client";
import { ApiError, rpc, rpcJson, rpcVoid } from "./rpc";

type CreateCipherPayload = InferRequestType<
	typeof rpc.api.ciphers.$post
>["json"];
type UpdateCipherPayload = InferRequestType<
	(typeof rpc.api.ciphers)[":id"]["$put"]
>["json"];

export async function syncVault(): Promise<SyncResponse> {
	const response = await rpc.api.sync.$get();
	return rpcJson(response) as Promise<SyncResponse>;
}

export async function fetchRevisionDateApi(): Promise<number> {
	const revision = await rpcJson(
		await rpc.api.accounts["revision-date"].$get(),
	);
	const value = Number(revision);
	if (!Number.isFinite(value)) throw new Error("Invalid vault revision date");
	return value;
}

export async function createRealtimeTicketApi(): Promise<{
	token: string;
	expiresIn: number;
}> {
	return rpcJson(await rpc.api.notifications.token.$post()) as Promise<{
		token: string;
		expiresIn: number;
	}>;
}

/**
 * 5. Fetch domain settings
 */
export async function fetchDomainRules(): Promise<DomainRulesResponse> {
	const response = await rpc.api.settings.domains.$get();
	return rpcJson(response) as Promise<DomainRulesResponse>;
}

/**
 * 6. Update domain settings
 */
export async function updateDomainRules(
	customEquivalentDomains: CustomEquivalentDomain[],
	excludedGlobalEquivalentDomains: number[],
): Promise<DomainRulesResponse> {
	const response = await rpc.api.settings.domains.$put({
		json: { customEquivalentDomains, excludedGlobalEquivalentDomains },
	});
	return rpcJson(response) as Promise<DomainRulesResponse>;
}

/**
 * 7. Create a vault item (cipher)
 */
export async function createCipherApi(
	payload: CreateCipherPayload,
): Promise<CipherResponse> {
	const response = await rpc.api.ciphers.$post({ json: payload });
	return rpcJson(response) as Promise<CipherResponse>;
}

/**
 * 8. Update a vault item (cipher)
 */
export async function updateCipherApi(
	id: string,
	payload: UpdateCipherPayload,
): Promise<CipherResponse> {
	const response = await rpc.api.ciphers[":id"].$put({
		param: { id },
		json: payload,
	});
	return rpcJson(response) as Promise<CipherResponse>;
}

/**
 * 9. Delete a vault item (cipher)
 */
export async function deleteCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].delete.$put({ param: { id } }));
}

export async function restoreCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].restore.$put({ param: { id } }));
}

export async function archiveCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].archive.$put({ param: { id } }));
}

export async function unarchiveCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].unarchive.$put({ param: { id } }));
}

export async function hardDeleteCipherApi(id: string): Promise<void> {
	await rpcJson(await rpc.api.ciphers[":id"].$delete({ param: { id } }));
}

export async function deleteCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.ciphers.delete.$put({ json: { ids } }));
}

export async function restoreCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.ciphers.restore.$post({ json: { ids } }));
}

export async function archiveCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.ciphers.archive.$put({ json: { ids } }));
}

export async function unarchiveCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(await rpc.api.ciphers.unarchive.$put({ json: { ids } }));
}

export async function hardDeleteCiphersApi(ids: string[]): Promise<void> {
	await rpcJson(
		await rpc.api.ciphers["delete-permanent"].$post({ json: { ids } }),
	);
}

export async function createAttachmentApi(
	cipherId: string,
	payload: { fileName: string; key: string; fileSize: number },
): Promise<{ attachmentId: string; url: string }> {
	return rpcJson(
		await rpc.api.ciphers[":id"].attachment.v2.$post({
			param: { id: cipherId },
			json: payload,
		}),
	) as Promise<{ attachmentId: string; url: string }>;
}

export async function uploadAttachmentApi(
	url: string,
	encryptedData: Uint8Array,
): Promise<void> {
	const response = await fetch(url, {
		method: "PUT",
		headers: { "Content-Type": "application/octet-stream" },
		body: encryptedData as BodyInit,
	});
	if (!response.ok)
		throw new ApiError(
			`附件上传失败 (${response.status})`,
			response.status,
			await response.text().catch(() => null),
		);
}

export async function downloadAttachmentApi(
	cipherId: string,
	attachmentId: string,
): Promise<Uint8Array> {
	const response = await rpc.api.ciphers[":id"].attachment[
		":attachmentId"
	].$get({ param: { id: cipherId, attachmentId } });
	if (!response.ok)
		throw new ApiError(
			`附件下载失败 (${response.status})`,
			response.status,
			await response.text().catch(() => null),
		);
	return new Uint8Array(await response.arrayBuffer());
}

export async function deleteAttachmentApi(
	cipherId: string,
	attachmentId: string,
): Promise<void> {
	await rpcJson(
		await rpc.api.ciphers[":id"].attachment[":attachmentId"].$delete({
			param: { id: cipherId, attachmentId },
		}),
	);
}
