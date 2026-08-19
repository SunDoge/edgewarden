import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	remove: vi.fn(),
	download: vi.fn(),
	upload: vi.fn(),
	decrypt: vi.fn(),
	prepare: vi.fn(),
	safeName: vi.fn(),
}));

vi.mock("./api-vault", () => ({
	createAttachmentApi: mocks.create,
	deleteAttachmentApi: mocks.remove,
	downloadAttachmentApi: mocks.download,
	uploadAttachmentApi: mocks.upload,
}));

vi.mock("./attachment-crypto", () => ({
	decryptAttachmentFile: mocks.decrypt,
	prepareAttachment: mocks.prepare,
	safeAttachmentFileName: mocks.safeName,
}));

import {
	downloadVaultAttachment,
	uploadVaultAttachment,
} from "./vault-attachments";

const cipher = { id: "cipher-1", key: null };
const ownerKeys = {
	encKey: new Uint8Array([1]),
	macKey: new Uint8Array([2]),
};

describe("vault attachment actions", () => {
	beforeEach(() => vi.clearAllMocks());

	it("creates metadata before uploading encrypted bytes", async () => {
		const encryptedData = new Uint8Array([3, 4]);
		const metadata = { fileName: "encrypted", key: "key", fileSize: 2 };
		mocks.prepare.mockResolvedValue({ metadata, encryptedData });
		mocks.create.mockResolvedValue({ attachmentId: "attachment-1", url: "/u" });
		mocks.upload.mockResolvedValue(undefined);

		await uploadVaultAttachment(cipher, {} as File, ownerKeys);

		expect(mocks.create).toHaveBeenCalledWith(cipher.id, metadata);
		expect(mocks.upload).toHaveBeenCalledWith("/u", encryptedData);
		expect(mocks.remove).not.toHaveBeenCalled();
	});

	it("removes orphaned metadata when the data upload fails", async () => {
		mocks.prepare.mockResolvedValue({
			metadata: {},
			encryptedData: new Uint8Array(),
		});
		mocks.create.mockResolvedValue({ attachmentId: "attachment-1", url: "/u" });
		mocks.upload.mockRejectedValue(new Error("upload failed"));
		mocks.remove.mockResolvedValue(undefined);

		await expect(
			uploadVaultAttachment(cipher, {} as File, ownerKeys),
		).rejects.toThrow("upload failed");
		expect(mocks.remove).toHaveBeenCalledWith(cipher.id, "attachment-1");
	});

	it("downloads, decrypts and sanitizes the attachment name", async () => {
		const encrypted = new Uint8Array([5]);
		const bytes = new Uint8Array([6]);
		const keys = { enc: new Uint8Array([7]), mac: new Uint8Array([8]) };
		mocks.download.mockResolvedValue(encrypted);
		mocks.decrypt.mockResolvedValue(bytes);
		mocks.safeName.mockReturnValue("safe.txt");

		await expect(
			downloadVaultAttachment("cipher-1", {
				id: "attachment-1",
				fileName: "../unsafe.txt",
				_keys: keys,
			}),
		).resolves.toEqual({ bytes, fileName: "safe.txt" });
		expect(mocks.decrypt).toHaveBeenCalledWith(encrypted, keys);
	});
});
