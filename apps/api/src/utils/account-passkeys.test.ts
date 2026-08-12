import assert from "node:assert/strict";
import { sign } from "hono/jwt";
import { test, vi } from "vitest";
import type { WorkerBindings } from "../worker-bindings";
import {
	createAccountPasskeyToken,
	getAccountPasskeyRpConfig,
	verifyAccountPasskeyToken,
} from "./account-passkeys";
import { deriveJwtPurposeSecret } from "./jwt";

const JWT_SECRET = "account-passkey-test-secret-at-least-thirty-two-characters";

test("derives WebAuthn RP configuration from the request by default", () => {
	assert.deepEqual(
		getAccountPasskeyRpConfig(
			new Request("https://vault.example.com/api/webauthn"),
			{} as WorkerBindings,
		),
		{
			rpId: "vault.example.com",
			rpName: "Edgewarden",
			origins: ["https://vault.example.com"],
		},
	);
});

test("normalizes configured WebAuthn RP values and extension origins", () => {
	const request = new Request("https://vault.example.com/api/webauthn", {
		headers: { Origin: "moz-extension://edgewarden" },
	});
	const config = getAccountPasskeyRpConfig(request, {
		WEBAUTHN_RP_ID: "  login.example.com ",
		WEBAUTHN_RP_NAME: " Example Vault ",
		WEBAUTHN_ALLOWED_ORIGINS:
			" https://login.example.com, https://secondary.example.com ",
	} as WorkerBindings);
	assert.equal(config.rpId, "login.example.com");
	assert.equal(config.rpName, "Example Vault");
	assert.deepEqual(config.origins, [
		"https://vault.example.com",
		"https://login.example.com",
		"https://secondary.example.com",
		"moz-extension://edgewarden",
	]);
});

test("rejects unsafe or non-canonical configured WebAuthn origins", () => {
	const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	try {
		const config = getAccountPasskeyRpConfig(
			new Request("https://vault.example.com/api/webauthn"),
			{
				WEBAUTHN_ALLOWED_ORIGINS:
					"http://evil.example.com,https://safe.example.com/path,https://user:secret@safe.example.com,http://localhost:5173",
			} as WorkerBindings,
		);
		assert.deepEqual(config.origins, [
			"https://vault.example.com",
			"http://localhost:5173",
		]);
		assert.equal(warning.mock.calls.length, 3);
	} finally {
		warning.mockRestore();
	}
});

test("validates account passkey token claims after signature verification", async () => {
	const token = await createAccountPasskeyToken(JWT_SECRET, {
		scope: "Authentication",
		challenge: "challenge",
		userId: "user-id",
		rpId: "vault.example.com",
		purpose: "login",
	});
	assert.equal(
		(
			await verifyAccountPasskeyToken(
				JWT_SECRET,
				token,
				"Authentication",
				"login",
			)
		)?.userId,
		"user-id",
	);
	assert.equal(
		await verifyAccountPasskeyToken(JWT_SECRET, token, "UpdateKeySet", "login"),
		null,
	);

	const now = Math.floor(Date.now() / 1000);
	const malformed = await sign(
		{
			typ: "edgewarden.account-passkey.challenge.v1",
			scope: 42,
			challenge: "challenge",
			userId: ["not", "a", "string"],
			rpId: "vault.example.com",
			purpose: "login",
			iat: now,
			exp: now + 60,
		},
		await deriveJwtPurposeSecret(JWT_SECRET, "account-passkey"),
	);
	assert.equal(
		await verifyAccountPasskeyToken(
			JWT_SECRET,
			malformed,
			"Authentication",
			"login",
		),
		null,
	);
});
