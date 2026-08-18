import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { env } from "cloudflare:workers";
import { applyD1Migrations, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { VaultRealtime } from "./durable-objects/vault-realtime";

declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("production Worker bindings", () => {
	it("applies the real D1 migrations", async () => {
		const schema = await env.DB.prepare("PRAGMA table_info(attachments)").all<{
			name: string;
		}>();
		expect(schema.results.some((column) => column.name === "storage_key")).toBe(
			true,
		);
	});

	it("round-trips bytes through the real R2 binding", async () => {
		const key = `platform-test/${crypto.randomUUID()}`;
		const expected = new Uint8Array([0, 1, 2, 253, 254, 255]);
		await env.ATTACHMENTS_R2.put(key, expected);
		const object = await env.ATTACHMENTS_R2.get(key);
		expect(object).not.toBeNull();
		expect(new Uint8Array(await object!.arrayBuffer())).toEqual(expected);
		await env.ATTACHMENTS_R2.delete(key);
	});

	it("instantiates the deployed Durable Object class", async () => {
		const stub = env.REALTIME.getByName(`platform-test-${crypto.randomUUID()}`);
		const isCurrentClass = await runInDurableObject(
			stub,
			(instance: VaultRealtime) => instance instanceof VaultRealtime,
		);
		expect(isCurrentClass).toBe(true);
	});
});
