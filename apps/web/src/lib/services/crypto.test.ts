import { describe, expect, it } from "vitest";
import { decryptCipher, encryptCipher } from "./cipher-crypto";
import {
	base64ToBytes,
	bytesToBase64,
	calcTotpNow,
	concatBytes,
	decryptBw,
	decryptStr,
	deriveMasterKey,
	encryptBw,
	encryptStr,
	hkdfExpand,
	rewrapUserKeyForMasterPassword,
} from "./crypto";

describe("frontend crypto utils", () => {
	it("bytesToBase64 and base64ToBytes should be duals", () => {
		const originalText = "hello, world! 123";
		const originalBytes = new TextEncoder().encode(originalText);

		const b64 = bytesToBase64(originalBytes);
		const restoredBytes = base64ToBytes(b64);
		const restoredText = new TextDecoder().decode(restoredBytes);

		expect(restoredText).toBe(originalText);
	});

	it("concatBytes should join two byte arrays", () => {
		const a = new Uint8Array([1, 2, 3]);
		const b = new Uint8Array([4, 5]);
		const joined = concatBytes(a, b);

		expect(Array.from(joined)).toEqual([1, 2, 3, 4, 5]);
	});

	it("encryptStr and decryptStr should encrypt and decrypt string inputs", async () => {
		const encKey = crypto.getRandomValues(new Uint8Array(32));
		const macKey = crypto.getRandomValues(new Uint8Array(32));
		const original = "my-secret-folder-name";

		const encrypted = await encryptStr(original, encKey, macKey);
		expect(encrypted).toContain("2.");

		const decrypted = await decryptStr(encrypted, encKey, macKey);
		expect(decrypted).toBe(original);
	});

	it("rejects ciphertext when its MAC is modified", async () => {
		const encKey = crypto.getRandomValues(new Uint8Array(32));
		const macKey = crypto.getRandomValues(new Uint8Array(32));
		const encrypted = await encryptBw(
			new TextEncoder().encode("secret"),
			encKey,
			macKey,
		);
		const parts = encrypted.split("|");
		const mac = base64ToBytes(parts[2]);
		mac[0] ^= 1;
		const tampered = `${parts[0]}|${parts[1]}|${bytesToBase64(mac)}`;
		await expect(decryptBw(tampered, encKey, macKey)).rejects.toThrow(
			"MAC mismatch",
		);
		await expect(decryptStr(tampered, encKey, macKey)).rejects.toThrow(
			"MAC mismatch",
		);
	});

	it("rejects a valid ciphertext with the wrong MAC key", async () => {
		const encKey = crypto.getRandomValues(new Uint8Array(32));
		const macKey = crypto.getRandomValues(new Uint8Array(32));
		const encrypted = await encryptBw(
			new TextEncoder().encode("secret"),
			encKey,
			macKey,
		);
		await expect(
			decryptBw(encrypted, encKey, crypto.getRandomValues(new Uint8Array(32))),
		).rejects.toThrow("MAC mismatch");
	});

	it("uses a fresh IV for each encryption", async () => {
		const encKey = crypto.getRandomValues(new Uint8Array(32));
		const macKey = crypto.getRandomValues(new Uint8Array(32));
		const plain = new TextEncoder().encode("same secret");
		await expect(
			Promise.all([
				encryptBw(plain, encKey, macKey),
				encryptBw(plain, encKey, macKey),
			]),
		).resolves.toSatisfy(([first, second]) => first !== second);
	});

	it("rewraps the same 64-byte user key under a new master password", async () => {
		const email = "security@example.com";
		const iterations = 10_000;
		const oldPassword = "old-password-for-test";
		const newPassword = "new-password-for-test";
		const userKey = crypto.getRandomValues(new Uint8Array(64));
		const oldMasterKey = await deriveMasterKey(oldPassword, email, iterations);
		const oldEnc = await hkdfExpand(new Uint8Array(oldMasterKey), "enc", 32);
		const oldMac = await hkdfExpand(new Uint8Array(oldMasterKey), "mac", 32);
		const profileKey = await encryptBw(userKey, oldEnc, oldMac);

		const wrapped = await rewrapUserKeyForMasterPassword({
			email,
			currentPassword: oldPassword,
			newPassword,
			iterations,
			profileKey,
		});
		const nextEnc = await hkdfExpand(
			new Uint8Array(wrapped.nextMasterKey),
			"enc",
			32,
		);
		const nextMac = await hkdfExpand(
			new Uint8Array(wrapped.nextMasterKey),
			"mac",
			32,
		);
		expect(await decryptBw(wrapped.protectedUserKey, nextEnc, nextMac)).toEqual(
			userKey,
		);
		await expect(
			decryptBw(wrapped.protectedUserKey, oldEnc, oldMac),
		).rejects.toThrow("MAC mismatch");
	});

	it("does not rewrap a profile key when the current password is wrong", async () => {
		const email = "security@example.com";
		const iterations = 2_000;
		const masterKey = await deriveMasterKey(
			"correct-password",
			email,
			iterations,
		);
		const enc = await hkdfExpand(new Uint8Array(masterKey), "enc", 32);
		const mac = await hkdfExpand(new Uint8Array(masterKey), "mac", 32);
		const profileKey = await encryptBw(
			crypto.getRandomValues(new Uint8Array(64)),
			enc,
			mac,
		);
		await expect(
			rewrapUserKeyForMasterPassword({
				email,
				currentPassword: "wrong-password",
				newPassword: "replacement-password",
				iterations,
				profileKey,
			}),
		).rejects.toThrow("MAC mismatch");
	});

	it("matches the RFC 6238 SHA-1 test vector", async () => {
		const result = await calcTotpNow(
			"otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=8&period=30",
			59_000,
		);
		expect(result).toEqual({ code: "94287082", remain: 1 });
	});

	it("generates Steam Guard codes from steam URIs", async () => {
		const result = await calcTotpNow(
			"steam://GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
			59_000,
		);
		expect(result).toEqual({ code: "PV9M4", remain: 1 });
	});

	it("round-trips a cipher with a per-item key", async () => {
		const userEnc = crypto.getRandomValues(new Uint8Array(32));
		const userMac = crypto.getRandomValues(new Uint8Array(32));
		const itemKey = crypto.getRandomValues(new Uint8Array(64));
		const wrappedKey = await encryptBw(itemKey, userEnc, userMac);
		const encrypted = await encryptCipher(
			{
				type: 1,
				name: "Example",
				notes: "private",
				favorite: false,
				folderId: null,
				login: {
					username: "me",
					password: "secret",
					totp: "JBSWY3DPEHPK3PXP",
					uris: [{ uri: "https://example.com", match: 1 }],
				},
				fields: [{ name: "PIN", value: "1234", type: 1 }],
				passwordHistory: [
					{ password: "old-secret", lastUsedDate: "2025-01-01T00:00:00Z" },
				],
				key: wrappedKey,
			},
			userEnc,
			userMac,
		);
		expect(JSON.stringify(encrypted)).not.toContain("secret");
		expect(JSON.stringify(encrypted)).not.toContain("1234");
		const decrypted = await decryptCipher(
			{ ...encrypted, id: "test" } as any,
			userEnc,
			userMac,
		);
		expect(decrypted.name).toBe("Example");
		expect(decrypted.login.password).toBe("secret");
		expect(decrypted.login.uris[0].uri).toBe("https://example.com");
		expect(decrypted.fields[0].value).toBe("1234");
		expect(decrypted.passwordHistory[0].password).toBe("old-secret");
	});

	it("preserves organization ownership metadata and binds the item key to the organization key", async () => {
		const orgEnc = crypto.getRandomValues(new Uint8Array(32));
		const orgMac = crypto.getRandomValues(new Uint8Array(32));
		const encrypted = await encryptCipher(
			{
				type: 1,
				name: "Shared secret",
				notes: null,
				favorite: false,
				folderId: null,
				organizationId: "org-1",
				collectionIds: ["collection-1"],
				login: { username: "member", password: "secret" },
			},
			orgEnc,
			orgMac,
		);
		expect(encrypted.organizationId).toBe("org-1");
		expect(encrypted.collectionIds).toEqual(["collection-1"]);
		const decrypted = await decryptCipher(
			{ ...encrypted, id: "shared" } as any,
			orgEnc,
			orgMac,
		);
		expect(decrypted.name).toBe("Shared secret");
		await expect(
			decryptCipher(
				{ ...encrypted, id: "shared" } as any,
				crypto.getRandomValues(new Uint8Array(32)),
				crypto.getRandomValues(new Uint8Array(32)),
			),
		).rejects.toThrow("MAC mismatch");
	});

	it("rejects a cipher whose wrapped item key was modified", async () => {
		const userEnc = crypto.getRandomValues(new Uint8Array(32));
		const userMac = crypto.getRandomValues(new Uint8Array(32));
		const wrappedKey = await encryptBw(
			crypto.getRandomValues(new Uint8Array(64)),
			userEnc,
			userMac,
		);
		const parts = wrappedKey.split("|");
		const mac = base64ToBytes(parts[2]);
		mac[0] ^= 1;
		const cipher = {
			id: "test",
			type: 1,
			name: "2.invalid|invalid|invalid",
			key: `${parts[0]}|${parts[1]}|${bytesToBase64(mac)}`,
		};
		await expect(
			decryptCipher(cipher as any, userEnc, userMac),
		).rejects.toThrow("MAC mismatch");
	});
});
