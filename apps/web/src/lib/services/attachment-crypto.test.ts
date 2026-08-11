import { describe, expect, it } from "vitest";
import { decryptAttachmentFile, decryptAttachmentMetadata, prepareAttachment, safeAttachmentFileName } from "./attachment-crypto";
import { encryptBw } from "./crypto";

describe("attachment client-side encryption", () => {
	it("encrypts metadata and bytes before upload and round-trips locally", async () => {
		const userEnc = crypto.getRandomValues(new Uint8Array(32));
		const userMac = crypto.getRandomValues(new Uint8Array(32));
		const itemRaw = crypto.getRandomValues(new Uint8Array(64));
		const cipher = { key: await encryptBw(itemRaw, userEnc, userMac) };
		const prepared = await prepareAttachment(cipher as any, new File(["top secret"], "payroll.txt"), userEnc, userMac);
		expect(JSON.stringify(prepared.metadata)).not.toMatch(/payroll|top secret/);
		expect(new TextDecoder().decode(prepared.encryptedData)).not.toContain("top secret");
		const attachment = await decryptAttachmentMetadata({ id: "a", size: prepared.encryptedData.length, sizeName: "", object: "attachment", ...prepared.metadata } as any, cipher as any, userEnc, userMac);
		expect(attachment.fileName).toBe("payroll.txt");
		expect(new TextDecoder().decode(await decryptAttachmentFile(prepared.encryptedData, attachment._keys))).toBe("top secret");
	});

	it("rejects tampered encrypted content", async () => {
		const userEnc = crypto.getRandomValues(new Uint8Array(32));
		const userMac = crypto.getRandomValues(new Uint8Array(32));
		const prepared = await prepareAttachment({ key: null } as any, new File(["secret"], "a.txt"), userEnc, userMac);
		const attachment = await decryptAttachmentMetadata({ id: "a", size: 1, sizeName: "", object: "attachment", ...prepared.metadata } as any, { key: null } as any, userEnc, userMac);
		prepared.encryptedData[prepared.encryptedData.length - 1] ^= 1;
		await expect(decryptAttachmentFile(prepared.encryptedData, attachment._keys)).rejects.toThrow();
	});

	it("sanitizes download file names", () => expect(safeAttachmentFileName("../secret\0.txt")).toBe(".._secret_.txt"));
});
