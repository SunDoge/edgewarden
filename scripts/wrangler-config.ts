export interface DeploymentConfig {
  name: string;
  d1_databases: Array<{
    binding: string;
    database_name: string;
    database_id?: string;
  }>;
  r2_buckets?: unknown[];
  kv_namespaces?: Array<{ binding: string; id?: string }>;
  vars?: Record<string, unknown>;
  [key: string]: unknown;
}

export function createAttachmentDeploymentConfig(
  base: DeploymentConfig,
  backend: "r2" | "kv",
): DeploymentConfig {
  const config = structuredClone(base);
  if (backend === "r2") return config;
  delete config.r2_buckets;
  config.kv_namespaces = [{ binding: "ATTACHMENTS_KV" }];
  config.vars = { ...config.vars, ATTACHMENT_STORAGE: "kv" };
  return config;
}

/** Public Demo accounts must never share production resources or routes. */
export function assertDemoIsolation(
  demo: DeploymentConfig,
  production: DeploymentConfig,
): void {
  if (
    demo.name !== "edgewarden-demo" ||
    demo.name === production.name ||
    demo.main !== "apps/api/src/demo/index.ts" ||
    demo.vars?.DEMO_MODE !== "readonly"
  )
    throw new Error("Invalid isolated Demo configuration");
  const database = demo.d1_databases.find((entry) => entry.binding === "DB");
  if (
    database?.database_name !== "edgewarden-demo-db" ||
    demo.d1_databases.length !== 1 ||
    production.d1_databases.some(
      (entry) =>
        entry.database_name === database.database_name ||
        (database.database_id && entry.database_id === database.database_id),
    )
  )
    throw new Error("Demo must use its own D1 database");
  const buckets = demo.r2_buckets as
    | Array<{ binding: string; bucket_name: string; jurisdiction?: string }>
    | undefined;
  const productionBuckets = production.r2_buckets as
    | Array<{ bucket_name: string }>
    | undefined;
  if (
    buckets?.length !== 1 ||
    buckets[0].binding !== "ATTACHMENTS_R2" ||
    buckets[0].bucket_name !== "edgewarden-demo-attachments" ||
    productionBuckets?.some(
      (bucket) => bucket.bucket_name === buckets[0].bucket_name,
    ) ||
    demo.kv_namespaces?.length
  )
    throw new Error(
      "Demo must use its own isolated R2 bucket (KV is unsupported)",
    );
  if (demo.routes || demo.route || demo.services)
    throw new Error(
      "Configure Demo domains separately; shared routes/services are forbidden",
    );
}
