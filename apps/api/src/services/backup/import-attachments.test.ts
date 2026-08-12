import { describe, expect, it, vi } from "vitest";
import type { BlobStore } from "../blob-store";
import { restoreBlobFiles } from "./import-attachments";

describe("restoreBlobFiles", () => {
	it("reads the portable archive path and writes a fresh storage key", async () => {
		const put = vi.fn(async () => undefined);
		const blobStore: BlobStore = {
			kind: "r2",
			maxObjectBytes: null,
			get: vi.fn(),
			put,
			delete: vi.fn(),
		};
		const bytes = new Uint8Array([1, 2, 3]);
		const row = {
			id: "attachment-id",
			cipher_id: "cipher-id",
			storage_key: "attachments/cipher-id/attachment-id.restore-id.bin",
			size: bytes.byteLength,
		};

		const result = await restoreBlobFiles(
			blobStore,
			{ attachments: [row] } as never,
			{ "attachments/cipher-id/attachment-id.bin": bytes },
		);

		expect(result.restoredAttachments).toEqual([row]);
		expect(put).toHaveBeenCalledWith(row.storage_key, bytes, {
			size: bytes.byteLength,
			contentType: "application/octet-stream",
		});
	});
});
