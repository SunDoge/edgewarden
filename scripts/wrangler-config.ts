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
