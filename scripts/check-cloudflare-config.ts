import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type WranglerConfig = Record<string, unknown> & {
	vars?: Record<string, unknown>;
};

async function readConfig(path: string): Promise<WranglerConfig> {
	return JSON.parse(
		await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
	);
}

function commonConfig(config: WranglerConfig): WranglerConfig {
	const normalized = structuredClone(config);
	delete normalized.kv_namespaces;
	delete normalized.r2_buckets;
	if (normalized.vars) delete normalized.vars.ATTACHMENT_STORAGE;
	return normalized;
}

const [r2, kv] = await Promise.all([
	readConfig("wrangler.jsonc"),
	readConfig("wrangler.kv.jsonc"),
]);

assert.deepEqual(commonConfig(kv), commonConfig(r2));
assert.deepEqual(r2.r2_buckets, [{ binding: "ATTACHMENTS_R2" }]);
assert.equal(r2.kv_namespaces, undefined);
assert.equal(r2.vars?.ATTACHMENT_STORAGE, "r2");
assert.deepEqual(kv.kv_namespaces, [{ binding: "ATTACHMENTS_KV" }]);
assert.equal(kv.r2_buckets, undefined);
assert.equal(kv.vars?.ATTACHMENT_STORAGE, "kv");

console.log("Cloudflare R2 and KV deployment configs are in sync.");
