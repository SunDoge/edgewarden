import { describe, expect, it } from "vitest";
import { bytesToBase64, encryptBw } from "./crypto";
import { createOrganizationMaterials, importAccountPrivateKey, unwrapOrganizationKey, wrapOrganizationKey } from "./organization-crypto";

describe("organization key envelopes", () => {
	it("wraps each organization key to an account RSA key", async () => {
		const accountPair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-1" }, true, ["encrypt", "decrypt"]);
		const accountPublic = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("spki", accountPair.publicKey)));
		const accountPrivate = new Uint8Array(await crypto.subtle.exportKey("pkcs8", accountPair.privateKey));
		const encKey = crypto.getRandomValues(new Uint8Array(32));
		const macKey = crypto.getRandomValues(new Uint8Array(32));
		const importedPrivate = await importAccountPrivateKey(await encryptBw(accountPrivate, encKey, macKey), encKey, macKey);
		const materials = await createOrganizationMaterials(accountPublic, "Default collection");
		const unwrapped = await unwrapOrganizationKey(materials.wrappedMemberKey, importedPrivate);
		expect(unwrapped.encKey).toEqual(materials.key.encKey);
		expect(unwrapped.macKey).toEqual(materials.key.macKey);
		expect(await wrapOrganizationKey(unwrapped, accountPublic)).toMatch(/^4\./);
	});
});
