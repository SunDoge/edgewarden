import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
	deleteBlobObject,
	getBlobObject,
	getBlobStorageKind,
	getBlobStorageMaxBytes,
	KV_MAX_OBJECT_BYTES,
	putBlobObject,
} from "./blob-store";

function storageBindings(preference: "kv" | "r2") {
	const kvValues = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
	const r2Values = new Map<
		string,
		{ value: ArrayBuffer; contentType: string }
	>();
	const kv = {
		put: async (key: string, value: BodyInit, options: any) =>
			kvValues.set(key, {
				value: await new Response(value).arrayBuffer(),
				metadata: options.metadata,
			}),
		getWithMetadata: async (key: string) => ({
			value: kvValues.get(key)?.value ?? null,
			metadata: kvValues.get(key)?.metadata ?? null,
		}),
		delete: async (key: string) => {
			kvValues.delete(key);
		},
	};
	const r2 = {
		put: async (key: string, value: BodyInit, options: any) =>
			r2Values.set(key, {
				value: await new Response(value).arrayBuffer(),
				contentType: options.httpMetadata.contentType,
			}),
		get: async (key: string) => {
			const entry = r2Values.get(key);
			return entry
				? {
						body: new Response(entry.value).body,
						size: entry.value.byteLength,
						httpMetadata: { contentType: entry.contentType },
					}
				: null;
		},
		delete: async (key: string) => {
			r2Values.delete(key);
		},
	};
	return {
		env: {
			ATTACHMENT_STORAGE: preference,
			ATTACHMENTS_KV: kv,
			ATTACHMENTS_R2: r2,
		} as unknown as CloudflareBindings,
		kvValues,
		r2Values,
	};
}

describe("attachment blob storage", () => {
	test("selects the configured backend and applies its size limit", () => {
		const { env } = storageBindings("kv");
		assert.equal(getBlobStorageKind(env), "kv");
		assert.equal(
			getBlobStorageMaxBytes(env, KV_MAX_OBJECT_BYTES * 2),
			KV_MAX_OBJECT_BYTES,
		);
		(env as any).ATTACHMENT_STORAGE = "r2";
		assert.equal(getBlobStorageKind(env), "r2");
		assert.equal(
			getBlobStorageMaxBytes(env, KV_MAX_OBJECT_BYTES * 2),
			KV_MAX_OBJECT_BYTES * 2,
		);
	});

	test("writes to the selected backend and reads through the other backend during migration", async () => {
		const { env, kvValues, r2Values } = storageBindings("kv");
		const body = new TextEncoder().encode("encrypted attachment");
		await putBlobObject(env, "attachment", body, {
			size: body.byteLength,
			contentType: "application/test",
		});
		assert.equal(kvValues.has("attachment"), true);
		assert.equal(r2Values.has("attachment"), false);

		(env as any).ATTACHMENT_STORAGE = "r2";
		const migratedRead = await getBlobObject(env, "attachment");
		assert.equal(
			await new Response(migratedRead?.body).text(),
			"encrypted attachment",
		);
	});

	test("deletes an object from both configured backends", async () => {
		const { env, kvValues, r2Values } = storageBindings("kv");
		const body = new Uint8Array([1, 2, 3]).buffer;
		await putBlobObject(env, "attachment", body, { size: body.byteLength });
		(env as any).ATTACHMENT_STORAGE = "r2";
		await putBlobObject(env, "attachment", body, { size: body.byteLength });
		await deleteBlobObject(env, "attachment");
		assert.equal(kvValues.has("attachment"), false);
		assert.equal(r2Values.has("attachment"), false);
	});
});
