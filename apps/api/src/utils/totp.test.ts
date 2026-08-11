import assert from "node:assert";
import { describe, test } from "vitest";
import * as OTPAuth from "otpauth";
import { verifyTotpToken, isTotpEnabled } from "./totp";

describe("totp utils", () => {
	describe("isTotpEnabled", () => {
		test("returns true for a non-empty secret", () => {
			assert.strictEqual(isTotpEnabled("JBSWY3DPEHPK3PXP"), true);
		});

		test("returns false for null, undefined, or empty/whitespace secret", () => {
			assert.strictEqual(isTotpEnabled(null), false);
			assert.strictEqual(isTotpEnabled(undefined), false);
			assert.strictEqual(isTotpEnabled(""), false);
			assert.strictEqual(isTotpEnabled("   "), false);
		});
	});

	describe("verifyTotpToken", () => {
		const validSecret = "JBSWY3DPEHPK3PXP"; // "Hello!" in base32

		test("verifies a valid token", async () => {
			const totp = new OTPAuth.TOTP({
				secret: OTPAuth.Secret.fromBase32(validSecret),
				digits: 6,
				period: 30,
			});
			const token = totp.generate();
			const result = await verifyTotpToken(validSecret, token);
			assert.strictEqual(result, true);
		});

		test("verifies a valid token with spaces", async () => {
			const totp = new OTPAuth.TOTP({
				secret: OTPAuth.Secret.fromBase32(validSecret),
				digits: 6,
				period: 30,
			});
			const token = totp.generate();
			const formattedToken = `${token.slice(0, 3)} ${token.slice(3)}`;
			const result = await verifyTotpToken(validSecret, formattedToken);
			assert.strictEqual(result, true);
		});

		test("fails on invalid token", async () => {
			const result = await verifyTotpToken(validSecret, "000000");
			assert.strictEqual(result, false);
		});

		test("fails on invalid secret", async () => {
			const result = await verifyTotpToken("invalid_secret_!!!", "123456");
			assert.strictEqual(result, false);
		});
	});
});
