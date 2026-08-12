import { describe, expect, it } from "vitest";
import {
	type SendPasswordFields,
	setSendPassword,
	verifySendPassword,
	verifySendPasswordHashB64,
} from "./password";

describe("send passwords", () => {
	it("derives and verifies a password without storing the plaintext", async () => {
		const send: SendPasswordFields = { auth_type: 2 };

		await setSendPassword(send, "correct horse battery staple");

		expect(send.password_hash).toBeTruthy();
		expect(send.password_salt).toBeTruthy();
		expect(send.password_algorithm).toBe("pbkdf2-sha256");
		expect(send.password_iterations).toBe(100000);
		expect(send).not.toHaveProperty("password");
		expect(await verifySendPassword(send, "correct horse battery staple")).toBe(
			true,
		);
		expect(await verifySendPassword(send, "wrong password")).toBe(false);
	});

	it("clears all password metadata", async () => {
		const send: SendPasswordFields = { auth_type: 1 };
		await setSendPassword(send, "secret");
		await setSendPassword(send, null);

		expect(send).toMatchObject({
			password_hash: null,
			password_salt: null,
			password_iterations: null,
			password_algorithm: null,
			auth_type: 2,
		});
	});

	it("rejects malformed pre-hashed credentials", () => {
		expect(
			verifySendPasswordHashB64({ password_hash: "invalid!" }, "invalid!"),
		).toBe(false);
	});
});
