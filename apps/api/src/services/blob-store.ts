const DEFAULT_CONTENT_TYPE = "application/octet-stream";
export const KV_MAX_OBJECT_BYTES = 25 * 1024 * 1024;

interface KVBlobMetadata {
	size?: number;
	contentType?: string;
	customMetadata?: Record<string, string> | null;
}

type BlobBindings = CloudflareBindings & {
	ATTACHMENTS_R2?: R2Bucket;
	ATTACHMENTS?: R2Bucket;
	ATTACHMENTS_KV?: KVNamespace;
	ATTACHMENT_STORAGE?: string;
};

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

export interface BlobStore {
	readonly kind: "r2" | "kv";
	readonly maxObjectBytes: number | null;
	get(key: string): Promise<BlobObject | null>;
	put(
		key: string,
		value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
		options: PutBlobOptions,
	): Promise<void>;
	delete(key: string): Promise<void>;
}

function byteLength(value: string | ArrayBuffer | ArrayBufferView): number {
	if (typeof value === "string")
		return new TextEncoder().encode(value).byteLength;
	return value.byteLength;
}

async function readAndVerifyBytes(
	value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
	expectedSize: number,
): Promise<string | ArrayBuffer | ArrayBufferView> {
	if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
		throw new Error("Invalid blob size");
	}
	const materialized =
		value instanceof ReadableStream
			? await new Response(value).arrayBuffer()
			: value;
	if (byteLength(materialized) !== expectedSize) {
		throw new Error("Blob size does not match declared size");
	}
	return materialized;
}

function hasR2Storage(
	env: CloudflareBindings,
): env is CloudflareBindings & { ATTACHMENTS_R2: R2Bucket } {
	const bindings = env as BlobBindings;
	return !!bindings.ATTACHMENTS_R2 || !!bindings.ATTACHMENTS;
}

function hasKvStorage(
	env: CloudflareBindings,
): env is CloudflareBindings & { ATTACHMENTS_KV: KVNamespace } {
	return "ATTACHMENTS_KV" in env && !!env.ATTACHMENTS_KV;
}

export function getBlobStorageKind(
	env: CloudflareBindings,
): "r2" | "kv" | null {
	const configured = String(
		(env as BlobBindings).ATTACHMENT_STORAGE || "",
	).toLowerCase();
	if (configured === "kv" && hasKvStorage(env)) return "kv";
	if (configured === "r2" && hasR2Storage(env)) return "r2";
	if (hasR2Storage(env)) return "r2";
	if (hasKvStorage(env)) return "kv";
	return null;
}

function getR2Storage(env: CloudflareBindings): R2Bucket {
	const bindings = env as BlobBindings;
	return (bindings.ATTACHMENTS_R2 || bindings.ATTACHMENTS) as R2Bucket;
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

export function getStoredSendFileObjectKey(
	send: { id: string; storage_key?: string | null },
	fileId: string,
): string {
	return send.storage_key || getSendFileObjectKey(send.id, fileId);
}

export function createRestoredSendFileObjectKey(
	sendId: string,
	fileId: string,
): string {
	return `sends/${sendId}/${fileId}.${crypto.randomUUID()}.bin`;
}

export function getAttachmentObjectKey(
	cipherId: string,
	attachmentId: string,
): string {
	return `attachments/${cipherId}/${attachmentId}.bin`;
}

export function getStoredAttachmentObjectKey(attachment: {
	id: string;
	cipher_id: string;
	storage_key?: string | null;
}): string {
	return (
		attachment.storage_key ||
		getAttachmentObjectKey(attachment.cipher_id, attachment.id)
	);
}

export function createRestoredAttachmentObjectKey(
	cipherId: string,
	attachmentId: string,
): string {
	return `attachments/${cipherId}/${attachmentId}.${crypto.randomUUID()}.bin`;
}

export function createAttachmentUploadObjectKey(
	cipherId: string,
	attachmentId: string,
): string {
	return `attachments/${cipherId}/${attachmentId}.${crypto.randomUUID()}.bin`;
}

export function createSendFileUploadObjectKey(
	sendId: string,
	fileId: string,
): string {
	return `sends/${sendId}/${fileId}.${crypto.randomUUID()}.bin`;
}

export async function putBlobObject(
	env: CloudflareBindings,
	key: string,
	value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
	options: PutBlobOptions,
): Promise<void> {
	const contentType = options.contentType || DEFAULT_CONTENT_TYPE;

	if (getBlobStorageKind(env) === "r2") {
		const putOptions = {
			httpMetadata: { contentType },
			customMetadata: options.customMetadata,
		};
		if (value instanceof ReadableStream) {
			const FixedLengthStreamCtor = (
				globalThis as typeof globalThis & {
					FixedLengthStream?: typeof FixedLengthStream;
				}
			).FixedLengthStream;
			if (FixedLengthStreamCtor) {
				const fixedLength = new FixedLengthStreamCtor(options.size);
				await Promise.all([
					value.pipeTo(fixedLength.writable),
					getR2Storage(env).put(key, fixedLength.readable, putOptions),
				]);
			} else {
				const bytes = await readAndVerifyBytes(value, options.size);
				await getR2Storage(env).put(key, bytes, putOptions);
			}
		} else {
			await getR2Storage(env).put(
				key,
				await readAndVerifyBytes(value, options.size),
				putOptions,
			);
		}
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
		// KV accepts streams but does not expose the stored length on reads. Buffering
		// here lets us reject truncated uploads before publishing their D1 row.
		const bytes = await readAndVerifyBytes(value, options.size);
		await env.ATTACHMENTS_KV.put(key, bytes, { metadata });
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

		const body = new Response(result.value).body;

		return {
			body,
			size: result.value.byteLength,
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
	const deletions: Array<{ backend: "r2" | "kv"; run: () => Promise<void> }> =
		[];
	if (hasR2Storage(env))
		deletions.push({
			backend: "r2",
			run: () => getR2Storage(env).delete(key),
		});
	if (hasKvStorage(env))
		deletions.push({
			backend: "kv",
			run: () => env.ATTACHMENTS_KV.delete(key),
		});
	const results = await Promise.allSettled(
		deletions.map(({ run }) => Promise.resolve().then(run)),
	);
	const failures = results.flatMap((result, index) =>
		result.status === "rejected"
			? [
					new Error(
						`Failed to delete ${deletions[index]?.backend || "unknown"} blob: ${key}`,
						{ cause: result.reason },
					),
				]
			: [],
	);
	if (failures.length) {
		throw new AggregateError(failures, `Failed to delete blob: ${key}`);
	}
}

export function createBlobStore(env: CloudflareBindings): BlobStore | null {
	const kind = getBlobStorageKind(env);
	if (!kind) return null;

	return {
		kind,
		maxObjectBytes: kind === "kv" ? KV_MAX_OBJECT_BYTES : null,
		get: (key) => getBlobObject(env, key),
		put: (key, value, options) => putBlobObject(env, key, value, options),
		delete: (key) => deleteBlobObject(env, key),
	};
}
