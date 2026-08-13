import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { publishVaultChange } from "./realtime";

test("publishes one vault revision event per distinct user", async () => {
	const deliveries: Array<{ userId: string; body: unknown }> = [];
	const env = {
		REALTIME: {
			getByName(userId: string) {
				return {
					async fetch(_url: string, init: RequestInit) {
						deliveries.push({ userId, body: JSON.parse(String(init.body)) });
						return new Response(null, { status: 204 });
					},
				};
			},
		},
	} as unknown as CloudflareBindings;

	assert.deepEqual(
		await publishVaultChange(env, ["user-a", "user-b", "user-a"], 1234),
		{ delivered: 2, failed: 0 },
	);
	assert.deepEqual(deliveries, [
		{
			userId: "user-a",
			body: { type: "vault-revision", revisionDate: 1234, userId: "user-a" },
		},
		{
			userId: "user-b",
			body: { type: "vault-revision", revisionDate: 1234, userId: "user-b" },
		},
	]);
});

test("reports rejected and non-successful realtime deliveries", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
	const env = {
		REALTIME: {
			getByName(userId: string) {
				return {
					async fetch() {
						if (userId === "rejected") throw new Error("DO unavailable");
						return new Response(null, { status: 503 });
					},
				};
			},
		},
	} as unknown as CloudflareBindings;
	try {
		assert.deepEqual(
			await publishVaultChange(env, ["rejected", "unavailable"], 1234),
			{ delivered: 0, failed: 2 },
		);
		assert.equal(error.mock.calls.length, 2);
		assert.ok(
			error.mock.calls.every(([message]) =>
				String(message).includes('"event":"realtime.broadcast.failed"'),
			),
		);
	} finally {
		error.mockRestore();
	}
});
