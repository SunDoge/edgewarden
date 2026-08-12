export type SqlRow = Record<string, string | number | null>;

export type BackupTableName =
	| "config"
	| "users"
	| "domain_settings"
	| "user_revisions"
	| "organizations"
	| "org_members"
	| "collections"
	| "collection_members"
	| "folders"
	| "ciphers"
	| "cipher_collections"
	| "attachments"
	| "webauthn_credentials"
	| "device_trust_tokens"
	| "audit_logs"
	| "sends";

const BACKUP_TABLES: BackupTableName[] = [
	"config",
	"users",
	"domain_settings",
	"user_revisions",
	"organizations",
	"org_members",
	"collections",
	"collection_members",
	"folders",
	"ciphers",
	"cipher_collections",
	"attachments",
	"webauthn_credentials",
	"device_trust_tokens",
	"audit_logs",
	"sends",
];

export function shadowTableName(table: BackupTableName): string {
	return `${table}__restore`;
}

export async function queryRows(
	db: D1Database,
	sql: string,
	...values: unknown[]
): Promise<SqlRow[]> {
	const response = await db
		.prepare(sql)
		.bind(...values)
		.all<SqlRow>();
	return (response.results || []).map((row) => ({ ...row }));
}

async function getTableCreateSql(
	db: D1Database,
	table: BackupTableName,
): Promise<string> {
	const row = await db
		.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
		.bind(table)
		.first<{ sql: string | null }>();
	const sql = String(row?.sql || "").trim();
	if (!sql) {
		throw new Error(
			`Restore shadow schema is missing table definition for ${table}`,
		);
	}
	return sql;
}

export function buildShadowTableCreateSql(
	createSql: string,
	table: BackupTableName,
): string {
	const tablePattern = new RegExp(
		`^CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+(?:"${table}"|${table})(?=\\s*\\()`,
		"i",
	);
	let next = createSql.replace(
		tablePattern,
		`CREATE TABLE "${shadowTableName(table)}"`,
	);
	if (next === createSql) {
		throw new Error(
			`Restore shadow schema could not rewrite CREATE TABLE statement for ${table}`,
		);
	}
	for (const currentTable of BACKUP_TABLES) {
		const referencePattern = new RegExp(
			`\\bREFERENCES\\s+(?:"${currentTable}"|${currentTable})(?=\\s*\\()`,
			"gi",
		);
		next = next.replace(
			referencePattern,
			`REFERENCES "${shadowTableName(currentTable)}"`,
		);
	}
	return next;
}

export async function resetRestoreArtifacts(db: D1Database): Promise<void> {
	const statements = BACKUP_TABLES.slice()
		.reverse()
		.map((table) =>
			db.prepare(`DROP TABLE IF EXISTS ${shadowTableName(table)}`),
		);
	if (statements.length) await db.batch(statements);
}

export async function createShadowTables(db: D1Database): Promise<void> {
	const statements: D1PreparedStatement[] = [];
	for (const table of BACKUP_TABLES) {
		statements.push(
			db.prepare(
				buildShadowTableCreateSql(await getTableCreateSql(db, table), table),
			),
		);
	}
	// The cipher table references folders(id, user_id); CREATE TABLE cloning does
	// not copy the UNIQUE index required by that composite foreign key.
	statements.push(
		db.prepare(
			`CREATE UNIQUE INDEX folders__restore_id_user ON ${shadowTableName("folders")}(id, user_id)`,
		),
	);
	await db.batch(statements);
}

export async function validateShadowTableCounts(
	db: D1Database,
	expectedCounts: Partial<Record<BackupTableName, number>>,
): Promise<void> {
	const results = await db.batch(
		BACKUP_TABLES.map((table) =>
			db.prepare(`SELECT COUNT(*) AS count FROM ${shadowTableName(table)}`),
		),
	);
	for (const [index, table] of BACKUP_TABLES.entries()) {
		const expected = expectedCounts[table] ?? 0;
		const actual = Number(
			(results[index]?.results?.[0] as { count?: number } | undefined)?.count ??
				0,
		);
		if (actual !== expected) {
			throw new Error(
				`Restore shadow validation failed for ${table}: expected ${expected}, received ${actual}`,
			);
		}
	}
}

function buildResetImportTargetStatements(
	db: D1Database,
): D1PreparedStatement[] {
	return [
		"DELETE FROM audit_logs",
		"DELETE FROM sends",
		"DELETE FROM attachments",
		"DELETE FROM cipher_collections",
		"DELETE FROM ciphers",
		"DELETE FROM folders",
		"DELETE FROM collection_members",
		"DELETE FROM collections",
		"DELETE FROM org_members",
		"DELETE FROM organizations",
		"DELETE FROM webauthn_credentials",
		"DELETE FROM device_trust_tokens",
		"DELETE FROM domain_settings",
		"DELETE FROM user_revisions",
		"DELETE FROM users",
		"DELETE FROM config",
	].map((sql) => db.prepare(sql));
}

function preserveAuditTombstonesStatement(db: D1Database): D1PreparedStatement {
	return db.prepare(`
		INSERT OR REPLACE INTO ${shadowTableName("audit_logs")} (
			id, actor_user_id, action, category, level,
			target_type, target_id, metadata, is_tombstone, created_at
		)
		SELECT
			log.id,
			CASE
				WHEN EXISTS (
					SELECT 1 FROM ${shadowTableName("users")} restored_user
					WHERE restored_user.id = log.actor_user_id
				) THEN log.actor_user_id
				ELSE NULL
			END,
			log.action, log.category, log.level,
			log.target_type, log.target_id, log.metadata,
			log.is_tombstone, log.created_at
		FROM audit_logs log
		WHERE log.is_tombstone = 1
	`);
}

export async function swapShadowTablesIntoPlace(
	db: D1Database,
	previousBlobKeys: Iterable<string> = [],
): Promise<void> {
	// A restore may roll business data back, but it must not erase deletion
	// evidence created after the backup. Merge tombstones into the shadow table
	// before the atomic swap. If the restored user set no longer contains the
	// original actor, retain the event with a NULL actor rather than violating
	// the audit foreign key.
	const statements = [
		preserveAuditTombstonesStatement(db),
		...buildResetImportTargetStatements(db),
	];
	const timestamp = Math.floor(Date.now() / 1000);
	for (const key of new Set(previousBlobKeys)) {
		if (!key) continue;
		statements.push(
			db
				.prepare(
					"INSERT OR IGNORE INTO blob_gc_queue (object_key, attempts, next_attempt_at, last_error, created_at) VALUES (?, 0, ?, NULL, ?)",
				)
				.bind(key, timestamp, timestamp),
		);
	}
	for (const table of BACKUP_TABLES) {
		statements.push(
			db.prepare(
				`INSERT INTO ${table} SELECT * FROM ${shadowTableName(table)}`,
			),
		);
	}
	await db.batch(statements);
}

export async function ensureImportTargetIsFresh(db: D1Database): Promise<void> {
	const counts = await db.batch(
		["ciphers", "folders", "attachments", "sends"].map((table) =>
			db.prepare(`SELECT COUNT(*) AS count FROM ${table}`),
		),
	);
	const total = counts.reduce(
		(sum, result) =>
			sum +
			Number(
				(result.results?.[0] as { count?: number } | undefined)?.count ?? 0,
			),
		0,
	);
	if (total > 0) {
		throw new Error(
			"Backup import requires a fresh instance with no vault or send data",
		);
	}
}

export async function collectCurrentBlobKeys(
	db: D1Database,
): Promise<Set<string>> {
	const keys = new Set<string>();
	const rows = await queryRows(
		db,
		`SELECT a.id, a.cipher_id, a.storage_key
     FROM attachments a
     INNER JOIN ciphers c ON c.id = a.cipher_id`,
	);
	for (const row of rows) {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		if (cipherId && attachmentId) {
			keys.add(
				String(row.storage_key || "").trim() ||
					`attachments/${cipherId}/${attachmentId}.bin`,
			);
		}
	}
	const sendRows = await queryRows(
		db,
		`SELECT id, storage_key, json_extract(data, '$.id') AS file_id
		 FROM sends
		 WHERE type = 1
		   AND json_valid(data)
		   AND json_type(data, '$.id') = 'text'`,
	);
	for (const row of sendRows) {
		const sendId = String(row.id || "").trim();
		const fileId = String(row.file_id || "").trim();
		if (sendId && fileId) {
			keys.add(
				String(row.storage_key || "").trim() || `sends/${sendId}/${fileId}`,
			);
		}
	}
	return keys;
}
