import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
	normalizeYubicoOtp,
	parseYubikeyConfig,
	serializeYubikeyConfig,
	verifyYubicoOtp,
	yubicoPublicId,
} from "./yubico";

function base64(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function hmac(secret: string, message: string): Promise<string> {
	const raw = Uint8Array.from(atob(secret), (character) =>
		character.charCodeAt(0),
	);
	const key = await crypto.subtle.importKey(
		"raw",
		raw,
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	return base64(
		new Uint8Array(
			await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
		),
	);
}

describe("Yubico OTP verification", () => {
	test("round-trips JSON configuration and safely rejects malformed values", () => {
		const stored = serializeYubikeyConfig({
			keys: ["ccccccbbbbbb"],
			nfc: true,
		});
		assert.deepEqual(parseYubikeyConfig(stored), {
			keys: ["ccccccbbbbbb"],
			nfc: true,
		});
		assert.deepEqual(parseYubikeyConfig("not-json"), { keys: [], nfc: false });
		assert.deepEqual(parseYubikeyConfig('{"keys":"invalid","nfc":true}'), {
			keys: [],
			nfc: false,
		});
		assert.deepEqual(
			parseYubikeyConfig(
				JSON.stringify({ keys: ["  CCCCCCBBBBBB  ", 3], nfc: false }),
			),
			{ keys: ["ccccccbbbbbb"], nfc: false },
		);
	});

	test("normalizes modhex and rejects public IDs without an OTP", () => {
		assert.equal(normalizeYubicoOtp("  CCCC BBBB \n"), "ccccbbbb");
		assert.equal(yubicoPublicId("ccccccbbbbbb"), null);
		assert.equal(
			yubicoPublicId("ccccccbbbbbbccccccbbbbbbccccccbb"),
			"ccccccbbbbbb",
		);
	});

	test("checks nonce, OTP, status and signed response", async () => {
		const secretKey = base64(crypto.getRandomValues(new Uint8Array(20)));
		const otp = "ccccccbbbbbbccccccbbbbbbccccccbb";
		const fetcher: typeof fetch = async (input) => {
			const request = new URL(String(input));
			const nonce = request.searchParams.get("nonce")!;
			const values = new URLSearchParams({
				nonce,
				otp,
				status: "OK",
				timestamp: "2026-08-11T00:00:00Z",
			});
			const canonical = [...values.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, value]) => `${key}=${value}`)
				.join("&");
			return new Response(
				`${canonical.split("&").join("\n")}\nh=${await hmac(secretKey, canonical)}\n`,
			);
		};
		assert.equal(
			await verifyYubicoOtp(otp, { clientId: "123", secretKey }, { fetcher }),
			true,
		);
		assert.equal(
			await verifyYubicoOtp(
				otp,
				{ clientId: "123", secretKey },
				{
					fetcher: async () =>
						new Response(`otp=${otp}\nstatus=OK\nh=forged\n`),
				},
			),
			false,
		);
	});
});
