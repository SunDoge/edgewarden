import assert from "node:assert/strict";
import { test } from "vitest";
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

	await publishVaultChange(env, ["user-a", "user-b", "user-a"], 1234);
	assert.deepEqual(deliveries, [
		{ userId: "user-a", body: { type: "vault-revision", revisionDate: 1234 } },
		{ userId: "user-b", body: { type: "vault-revision", revisionDate: 1234 } },
	]);
});
