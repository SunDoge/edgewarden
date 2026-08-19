export const DATA_OPERATION_LEASE_CONFIG_KEY = "backup.runner.lock.v1";

const DEFAULT_LEASE_SECONDS = 30 * 60;

export interface DataOperationLease {
  token: string;
  operation: string;
  expiresAt: number;
}

export class DataOperationLeaseLostError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`Data operation lease was lost: ${operation}`);
    this.name = "DataOperationLeaseLostError";
    this.operation = operation;
  }
}

export async function acquireDataOperationLease(
  db: D1Database,
  operation: string,
  timestamp = Math.floor(Date.now() / 1000),
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<DataOperationLease | null> {
  const token = crypto.randomUUID();
  const expiresAt = timestamp + leaseSeconds;
  const value = JSON.stringify({ token, operation, expiresAt });
  const results = await db.batch([
    db
      .prepare(`
				INSERT INTO config (key, value) VALUES (?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value
				WHERE NOT json_valid(config.value)
				   OR COALESCE(json_extract(config.value, '$.expiresAt'), 0) <= ?
			`)
      .bind(DATA_OPERATION_LEASE_CONFIG_KEY, value, timestamp),
    db
      .prepare("SELECT value FROM config WHERE key = ?")
      .bind(DATA_OPERATION_LEASE_CONFIG_KEY),
  ]);
  const stored = String(
    (results[1]?.results?.[0] as { value?: unknown } | undefined)?.value || "",
  );
  return stored === value ? { token, operation, expiresAt } : null;
}

export async function releaseDataOperationLease(
  db: D1Database,
  lease: DataOperationLease,
): Promise<void> {
  await db
    .prepare(`
			DELETE FROM config
			WHERE key = ?
			  AND json_valid(value)
			  AND json_extract(value, '$.token') = ?
		`)
    .bind(DATA_OPERATION_LEASE_CONFIG_KEY, lease.token)
    .run();
}

export async function renewDataOperationLease(
  db: D1Database,
  lease: DataOperationLease,
  timestamp = Math.floor(Date.now() / 1000),
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<boolean> {
  const expiresAt = timestamp + leaseSeconds;
  const value = JSON.stringify({
    token: lease.token,
    operation: lease.operation,
    expiresAt,
  });
  const result = await db
    .prepare(`
			UPDATE config SET value = ?
			WHERE key = ?
			  AND json_valid(value)
			  AND json_extract(value, '$.token') = ?
		`)
    .bind(value, DATA_OPERATION_LEASE_CONFIG_KEY, lease.token)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) return false;
  lease.expiresAt = expiresAt;
  return true;
}

export async function requireDataOperationLeaseRenewal(
  db: D1Database,
  lease: DataOperationLease,
): Promise<void> {
  if (!(await renewDataOperationLease(db, lease))) {
    throw new DataOperationLeaseLostError(lease.operation);
  }
}

export async function requireFreshDataOperationLease(
  db: D1Database,
  lease: DataOperationLease,
  minimumRemainingSeconds = 10 * 60,
): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000);
  if (lease.expiresAt - timestamp > minimumRemainingSeconds) return;
  if (!(await renewDataOperationLease(db, lease, timestamp))) {
    throw new DataOperationLeaseLostError(lease.operation);
  }
}

export async function readActiveDataOperationLeaseValue(
  db: D1Database,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  const row = await db
    .prepare(`
			SELECT value FROM config
			WHERE key = ?
			  AND json_valid(value)
			  AND COALESCE(json_extract(value, '$.expiresAt'), 0) > ?
		`)
    .bind(DATA_OPERATION_LEASE_CONFIG_KEY, timestamp)
    .first<{ value: string }>();
  return typeof row?.value === "string" ? row.value : null;
}

export async function withDataOperationLease<T>(
  db: D1Database,
  operation: string,
  callback: (lease: DataOperationLease) => Promise<T>,
): Promise<T> {
  const lease = await acquireDataOperationLease(db, operation);
  if (!lease) {
    throw new Error(
      "Another backup, restore, or maintenance operation is running",
    );
  }
  try {
    return await callback(lease);
  } finally {
    await releaseDataOperationLease(db, lease).catch((error) => {
      console.error(
        JSON.stringify({
          event: "data_operation.lease_release_failed",
          operation,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }
}
