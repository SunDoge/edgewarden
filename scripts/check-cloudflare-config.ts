import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OPTIONAL_WORKER_BINDING_NAMES } from "../apps/api/src/worker-bindings.ts";
import {
  createAttachmentDeploymentConfig,
  type DeploymentConfig,
} from "./wrangler-config.ts";

type WranglerConfig = DeploymentConfig & {
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

function assertPortableD1Bindings(
  config: WranglerConfig,
  filename: string,
): void {
  for (const database of config.d1_databases as Record<string, unknown>[]) {
    assert.equal(
      "database_id" in database,
      false,
      `${filename} must not commit an account-specific D1 database_id`,
    );
  }
}

const r2 = await readConfig("wrangler.jsonc");
const kv = createAttachmentDeploymentConfig(r2, "kv");
const deploymentDocumentation = await Promise.all([
  readFile(new URL("../README.md", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/README.md", import.meta.url), "utf8"),
]).then((documents) => documents.join("\n"));

assertPortableD1Bindings(r2, "wrangler.jsonc");
assertPortableD1Bindings(kv, "generated KV configuration");

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
for (const binding of OPTIONAL_WORKER_BINDING_NAMES) {
  assert.match(
    deploymentDocumentation,
    new RegExp(`\\b${binding}\\b`),
    `Optional Worker binding ${binding} must be documented`,
  );
}

console.log(
  "Cloudflare base config and generated KV deployment config are valid.",
);
