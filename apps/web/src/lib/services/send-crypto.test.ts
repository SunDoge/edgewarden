import { describe, expect, it } from "vitest";
import { decryptBw } from "./crypto";
import { createSendKeys, decodeSendShareKey, decryptOwnedSend, decryptPublicSend, encodeSendShareKey, encryptSendMetadata, wrapSendKey } from "./send-crypto";

describe("Send client-side encryption", () => {
	it("round-trips an exact 64-byte URL-fragment key", () => {
		const keys = createSendKeys();
		expect(decodeSendShareKey(encodeSendShareKey(keys.raw)).raw).toEqual(keys.raw);
		expect(() => decodeSendShareKey(encodeSendShareKey(keys.raw.slice(1)))).toThrow(/长度/);
		expect(() => decodeSendShareKey("bad$key")).toThrow(/格式/);
	});

	it("keeps names, notes and text encrypted in server payloads", async () => {
		const userEnc = crypto.getRandomValues(new Uint8Array(32));
		const userMac = crypto.getRandomValues(new Uint8Array(32));
		const keys = createSendKeys();
		const metadata = await encryptSendMetadata({ name: "Payroll", notes: "private note", text: "salary secret" }, keys);
		const owned = await decryptOwnedSend({ id: "s", type: 0, key: await wrapSendKey(keys, userEnc, userMac), ...metadata }, userEnc, userMac);
		expect(JSON.stringify(metadata)).not.toMatch(/Payroll|private note|salary secret/);
		expect(owned).toMatchObject({ name: "Payroll", notes: "private note", text: { text: "salary secret" } });
		const publicSend = await decryptPublicSend({ type: 0, name: metadata.name, text: metadata.text }, keys);
		expect(publicSend).toMatchObject({ name: "Payroll", text: "salary secret" });
	});

	it("encrypts file names with the Send key", async () => {
		const keys = createSendKeys();
		const encrypted = await encryptSendMetadata({ name: "Transfer" }, keys);
		const fileName = await (await import("./crypto")).encryptBw(new TextEncoder().encode("tax.pdf"), keys.enc, keys.mac);
		expect(new TextDecoder().decode(await decryptBw(fileName, keys.enc, keys.mac))).toBe("tax.pdf");
		expect(JSON.stringify({ ...encrypted, file: { fileName } })).not.toContain("tax.pdf");
	});
});
