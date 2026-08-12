export const DATA_OPERATION_LEASE_CONFIG_KEY = "backup.runner.lock.v1";

const DEFAULT_LEASE_SECONDS = 30 * 60;

export interface DataOperationLease {
	token: string;
	operation: string;
	expiresAt: number;
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

export async function withDataOperationLease<T>(
	db: D1Database,
	operation: string,
	callback: () => Promise<T>,
): Promise<T> {
	const lease = await acquireDataOperationLease(db, operation);
	if (!lease) {
		throw new Error(
			"Another backup, restore, or maintenance operation is running",
		);
	}
	try {
		return await callback();
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
