import assert from "node:assert";
import { describe, test } from "vitest";
import {
	constantTimeCredentialEqual,
	decryptCredential,
	encryptCredential,
	hashCredential,
} from "./credential-protection";

describe("credential protection", () => {
	const secret = "persistent-data-secret-that-is-at-least-32-characters";

	test("encrypts credentials with randomized authenticated envelopes", async () => {
		const first = await encryptCredential(
			"JBSWY3DPEHPK3PXP",
			secret,
			"totp-secret",
		);
		const second = await encryptCredential(
			"JBSWY3DPEHPK3PXP",
			secret,
			"totp-secret",
		);
		assert.notEqual(first, second);
		assert.equal(
			await decryptCredential(first, secret, "totp-secret"),
			"JBSWY3DPEHPK3PXP",
		);
		await assert.rejects(() =>
			decryptCredential(first, secret, "totp-recovery"),
		);
	});

	test("hashes bearer credentials deterministically", async () => {
		const first = await hashCredential("secret-api-key");
		const second = await hashCredential("secret-api-key");
		assert.equal(first, second);
		assert.equal(first.length, 64);
		assert.equal(constantTimeCredentialEqual(first, second), true);
		assert.equal(constantTimeCredentialEqual(first, `${second}0`), false);
	});
});
