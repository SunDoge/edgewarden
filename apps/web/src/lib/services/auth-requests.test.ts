import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, toBufferSource } from "./crypto";
import {
	encryptVaultKeyForAuthRequest,
	publicKeyFingerprint,
} from "./auth-requests";

describe("auth request cryptography", () => {
	it("encrypts exactly the current 64-byte vault key for the requester", async () => {
		const pair = await crypto.subtle.generateKey(
			{
				name: "RSA-OAEP",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-1",
			},
			true,
			["encrypt", "decrypt"],
		);
		const spki = new Uint8Array(
			await crypto.subtle.exportKey("spki", pair.publicKey),
		);
		const enc = crypto.getRandomValues(new Uint8Array(32));
		const mac = crypto.getRandomValues(new Uint8Array(32));
		const wrapped = await encryptVaultKeyForAuthRequest(
			bytesToBase64(spki),
			enc,
			mac,
		);
		expect(wrapped.startsWith("4.")).toBe(true);
		const decrypted = new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: "RSA-OAEP" },
				pair.privateKey,
				toBufferSource(base64ToBytes(wrapped.slice(2))),
			),
		);
		expect(decrypted.slice(0, 32)).toEqual(enc);
		expect(decrypted.slice(32)).toEqual(mac);
	});

	it("produces a stable account-bound public-key fingerprint", async () => {
		const publicKey = bytesToBase64(crypto.getRandomValues(new Uint8Array(64)));
		const first = await publicKeyFingerprint("User@Example.com", publicKey);
		expect(await publicKeyFingerprint("user@example.com", publicKey)).toBe(
			first,
		);
		expect(first).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{8}){4}$/);
		expect(await publicKeyFingerprint("other@example.com", publicKey)).not.toBe(
			first,
		);
	});

	it("rejects malformed or incorrectly sized key material", async () => {
		await expect(
			encryptVaultKeyForAuthRequest(
				"bad",
				new Uint8Array(31),
				new Uint8Array(32),
			),
		).rejects.toThrow("保险库密钥无效");
	});
});
