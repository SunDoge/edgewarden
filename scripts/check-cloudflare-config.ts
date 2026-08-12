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
	delete normalized.$schema;
	delete normalized.kv_namespaces;
	delete normalized.r2_buckets;
	if (Array.isArray(normalized.d1_databases)) {
		for (const database of normalized.d1_databases) {
			if (database && typeof database === "object")
				delete (database as Record<string, unknown>).database_id;
		}
	}
	if (normalized.vars) delete normalized.vars.ATTACHMENT_STORAGE;
	return normalized;
}

function portableD1Config(config: WranglerConfig): unknown {
	return (config.d1_databases as Record<string, unknown>[]).map(
		({ database_id: _databaseId, ...database }) => database,
	);
}

const [r2, kv] = await Promise.all([
	readConfig("wrangler.jsonc"),
	readConfig("wrangler.kv.jsonc"),
]);

assert.deepEqual(commonConfig(kv), commonConfig(r2));
assert.deepEqual(portableD1Config(r2), [
	{
		binding: "DB",
		database_name: "edgewarden-db",
		migrations_dir: "apps/api/migrations",
	},
]);
assert.deepEqual(r2.r2_buckets, [
	{ binding: "ATTACHMENTS_R2", bucket_name: "edgewarden-attachments" },
]);
assert.equal(r2.kv_namespaces, undefined);
assert.equal(r2.vars?.ATTACHMENT_STORAGE, "r2");
assert.deepEqual(kv.kv_namespaces, [{ binding: "ATTACHMENTS_KV" }]);
assert.deepEqual(portableD1Config(kv), portableD1Config(r2));
assert.equal(kv.r2_buckets, undefined);
assert.equal(kv.vars?.ATTACHMENT_STORAGE, "kv");

console.log("Cloudflare R2 and KV deployment configs are in sync.");
