import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { WorkerBindings } from "../worker-bindings";
import {
	turnstileEnabled,
	turnstileSiteKey,
	verifyTurnstileToken,
} from "./turnstile";

const env = {
	TURNSTILE_SECRET_KEY: "test-secret",
} as WorkerBindings;

describe("Turnstile verification", () => {
	test("is optional when no secret is configured", async () => {
		const disabled = {} as WorkerBindings;
		assert.equal(turnstileEnabled(disabled), false);
		assert.equal(turnstileSiteKey(disabled), null);
		assert.equal(await verifyTurnstileToken(disabled, "", "login"), true);
	});

	test("trims the optional public site key", () => {
		assert.equal(
			turnstileSiteKey({
				TURNSTILE_SITE_KEY: "  public-site-key  ",
			} as WorkerBindings),
			"public-site-key",
		);
	});

	test("sends the token and client IP to Siteverify and requires the login action", async () => {
		let submitted: Record<string, unknown> = {};
		const ok = await verifyTurnstileToken(
			env,
			"valid-token",
			"login",
			"203.0.113.10",
			async (_input, init) => {
				const form = init?.body as FormData;
				submitted = {
					response: form.get("response"),
					remoteip: form.get("remoteip"),
					idempotencyKey: form.get("idempotency_key"),
				};
				return Response.json({ success: true, action: "login" });
			},
		);
		assert.equal(ok, true);
		assert.equal(submitted.response, "valid-token");
		assert.equal(submitted.remoteip, "203.0.113.10");
		assert.equal(typeof submitted.idempotencyKey, "string");
		assert.equal(
			await verifyTurnstileToken(
				env,
				"valid-token",
				"login",
				undefined,
				async () => Response.json({ success: true, action: "register" }),
			),
			false,
		);
		assert.equal(
			await verifyTurnstileToken(
				env,
				"valid-token",
				"register",
				undefined,
				async () => Response.json({ success: true, action: "register" }),
			),
			true,
		);
	});

	test("fails closed for missing tokens and Siteverify failures", async () => {
		assert.equal(await verifyTurnstileToken(env, "", "login"), false);
		assert.equal(
			await verifyTurnstileToken(env, "token", "login", undefined, async () => {
				throw new Error("offline");
			}),
			false,
		);
		assert.equal(
			await verifyTurnstileToken(env, "token", "login", undefined, async () =>
				Response.json({ success: false }),
			),
			false,
		);
	});
});
