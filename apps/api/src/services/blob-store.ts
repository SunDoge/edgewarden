const DEFAULT_CONTENT_TYPE = "application/octet-stream";
export const KV_MAX_OBJECT_BYTES = 25 * 1024 * 1024;

interface KVBlobMetadata {
	size?: number;
	contentType?: string;
	customMetadata?: Record<string, string> | null;
}

export interface BlobObject {
	body: ReadableStream | null;
	size: number;
	contentType: string;
}

export interface PutBlobOptions {
	size: number;
	contentType?: string;
	customMetadata?: Record<string, string>;
}

function hasR2Storage(
	env: CloudflareBindings,
): env is CloudflareBindings & { ATTACHMENTS_R2: R2Bucket } {
	return !!(env as any).ATTACHMENTS_R2 || !!(env as any).ATTACHMENTS;
}

function hasKvStorage(
	env: CloudflareBindings,
): env is CloudflareBindings & { ATTACHMENTS_KV: KVNamespace } {
	return "ATTACHMENTS_KV" in env && !!env.ATTACHMENTS_KV;
}

export function getBlobStorageKind(
	env: CloudflareBindings,
): "r2" | "kv" | null {
	const configured = String((env as any).ATTACHMENT_STORAGE || "").toLowerCase();
	if (configured === "kv" && hasKvStorage(env)) return "kv";
	if (configured === "r2" && hasR2Storage(env)) return "r2";
	if (hasR2Storage(env)) return "r2";
	if (hasKvStorage(env)) return "kv";
	return null;
}

function getR2Storage(env: CloudflareBindings): R2Bucket {
	return ((env as any).ATTACHMENTS_R2 || (env as any).ATTACHMENTS) as R2Bucket;
}

export function getBlobStorageMaxBytes(
	env: CloudflareBindings,
	configuredLimit: number,
): number {
	if (getBlobStorageKind(env) === "kv") {
		return Math.min(configuredLimit, KV_MAX_OBJECT_BYTES);
	}
	return configuredLimit;
}

export function getSendFileObjectKey(sendId: string, fileId: string): string {
	return `sends/${sendId}/${fileId}`;
}

export function getAttachmentObjectKey(cipherId: string, attachmentId: string): string {
	return `attachments/${cipherId}/${attachmentId}.bin`;
}

export async function putBlobObject(
	env: CloudflareBindings,
	key: string,
	value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
	options: PutBlobOptions,
): Promise<void> {
	const contentType = options.contentType || DEFAULT_CONTENT_TYPE;

	if (getBlobStorageKind(env) === "r2") {
		await getR2Storage(env).put(key, value, {
			httpMetadata: { contentType },
			customMetadata: options.customMetadata,
		});
		return;
	}

	if (getBlobStorageKind(env) === "kv" && hasKvStorage(env)) {
		if (options.size > KV_MAX_OBJECT_BYTES) {
			throw new Error("KV object too large");
		}
		const metadata: KVBlobMetadata = {
			size: options.size,
			contentType,
			customMetadata: options.customMetadata || null,
		};
		await env.ATTACHMENTS_KV.put(key, value as any, { metadata });
		return;
	}

	throw new Error("Attachment storage is not configured");
}

export async function getBlobObject(
	env: CloudflareBindings,
	key: string,
): Promise<BlobObject | null> {
	const readR2 = async (): Promise<BlobObject | null> => {
		if (!hasR2Storage(env)) return null;
		const object = await getR2Storage(env).get(key);
		return object
			? {
					body: object.body,
					size: Number(object.size) || 0,
					contentType: object.httpMetadata?.contentType || DEFAULT_CONTENT_TYPE,
				}
			: null;
	};
	const readKv = async (): Promise<BlobObject | null> => {
		if (!hasKvStorage(env)) return null;
		const result = await env.ATTACHMENTS_KV.getWithMetadata<KVBlobMetadata>(
			key,
			"arrayBuffer",
		);
		if (!result.value) return null;

		const sizeFromMeta = Number(result.metadata?.size || 0);
		const size = sizeFromMeta > 0 ? sizeFromMeta : result.value.byteLength;
		const body = new Response(result.value).body;

		return {
			body,
			size,
			contentType: result.metadata?.contentType || DEFAULT_CONTENT_TYPE,
		};
	};

	const primary = getBlobStorageKind(env);
	if (primary === "kv") return (await readKv()) ?? readR2();
	if (primary === "r2") return (await readR2()) ?? readKv();
	return null;
}

export async function deleteBlobObject(
	env: CloudflareBindings,
	key: string,
): Promise<void> {
	await Promise.all([
		hasR2Storage(env) ? getR2Storage(env).delete(key) : Promise.resolve(),
		hasKvStorage(env) ? env.ATTACHMENTS_KV.delete(key) : Promise.resolve(),
	]);
}
