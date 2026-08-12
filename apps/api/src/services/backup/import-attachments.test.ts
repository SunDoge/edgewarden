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

	it("restores file Send bytes to a versioned storage key", async () => {
		const put = vi.fn(async () => undefined);
		const blobStore: BlobStore = {
			kind: "r2",
			maxObjectBytes: null,
			get: vi.fn(),
			put,
			delete: vi.fn(),
		};
		const bytes = new Uint8Array([4, 5, 6]);
		const row = {
			id: "send-id",
			type: 1,
			data: JSON.stringify({ id: "file-id", size: bytes.byteLength }),
			storage_key: "sends/send-id/file-id.restore-id.bin",
		};

		const result = await restoreBlobFiles(
			blobStore,
			{ attachments: [], sends: [row] } as never,
			{ "sends/send-id/file-id": bytes },
		);

		expect(result.restoredFileSends).toEqual([row]);
		expect(result.importedSendFiles).toBe(1);
		expect(put).toHaveBeenCalledWith(row.storage_key, bytes, {
			size: bytes.byteLength,
			contentType: "application/octet-stream",
		});
	});

	it("reports every staged key before a later blob write aborts restore", async () => {
		const staged: string[] = [];
		const blobStore: BlobStore = {
			kind: "r2",
			maxObjectBytes: null,
			get: vi.fn(),
			put: vi.fn(async (key: string) => {
				if (key.startsWith("sends/")) throw new Error("storage outage");
			}),
			delete: vi.fn(),
		};
		const attachment = {
			id: "attachment-id",
			cipher_id: "cipher-id",
			storage_key: "attachments/cipher-id/staged.bin",
			size: 1,
		};
		const send = {
			id: "send-id",
			type: 1,
			data: JSON.stringify({ id: "file-id", size: 1 }),
			storage_key: "sends/send-id/staged.bin",
		};

		await expect(
			restoreBlobFiles(
				blobStore,
				{ attachments: [attachment], sends: [send] } as never,
				{
					"attachments/cipher-id/attachment-id.bin": new Uint8Array([1]),
					"sends/send-id/file-id": new Uint8Array([2]),
				},
				(key) => staged.push(key),
			),
		).rejects.toThrow("Failed to restore backup blob: sends/send-id/file-id");
		expect(staged).toEqual([attachment.storage_key]);
	});
});
