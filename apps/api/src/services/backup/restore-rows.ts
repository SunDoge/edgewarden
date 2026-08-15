import type { BackupPayload } from "./archive";
import {
	type BackupTableName,
	type SqlRow,
	shadowTableName,
} from "./restore-database";

function buildInsertStatements(
	db: D1Database,
	table: string,
	columns: string[],
	rows: SqlRow[],
	upsert = false,
): D1PreparedStatement[] {
	if (!rows.length) return [];
	const placeholders = `(${columns.map(() => "?").join(", ")})`;
	const sql = `INSERT ${upsert ? "OR REPLACE " : ""}INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`;
	return rows.map((row) =>
		db.prepare(sql).bind(...columns.map((column) => row[column] ?? null)),
	);
}

async function runInsertBatch(
	db: D1Database,
	table: string,
	statements: D1PreparedStatement[],
): Promise<void> {
	if (!statements.length) return;
	try {
		await db.batch(statements);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Restore insert failed for ${table}: ${message}`);
	}
}

export async function importBackupRows(
	db: D1Database,
	payload: BackupPayload["db"],
	useShadowTables = false,
): Promise<void> {
	const tableName = (table: BackupTableName): string =>
		useShadowTables ? shadowTableName(table) : table;
	await runInsertBatch(
		db,
		tableName("config"),
		buildInsertStatements(
			db,
			tableName("config"),
			["key", "value"],
			payload.config || [],
			true,
		),
	);
	await runInsertBatch(
		db,
		tableName("users"),
		buildInsertStatements(
			db,
			tableName("users"),
			[
				"id",
				"email",
				"name",
				"master_password_hint",
				"master_password_hash",
				"key",
				"private_key",
				"public_key",
				"master_password_salt",
				"signed_public_key",
				"security_version",
				"security_state",
				"v2_upgrade_token",
				"user_key_id",
				"kdf_type",
				"kdf_iterations",
				"kdf_memory",
				"kdf_parallelism",
				"security_stamp",
				"role",
				"status",
				"deletion_requested_at",
				"verify_devices",
				"totp_secret",
				"totp_recovery_code",
				"yubikey_config",
				"created_at",
				"updated_at",
			],
			payload.users || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("user_revisions"),
		buildInsertStatements(
			db,
			tableName("user_revisions"),
			["user_id", "revision_date"],
			payload.user_revisions || [],
			true,
		),
	);
	await runInsertBatch(
		db,
		tableName("domain_settings"),
		buildInsertStatements(
			db,
			tableName("domain_settings"),
			[
				"user_id",
				"equivalent_domains",
				"custom_equivalent_domains",
				"excluded_global_equivalent_domains",
				"updated_at",
			],
			payload.domain_settings || [],
			true,
		),
	);
	await runInsertBatch(
		db,
		tableName("organizations"),
		buildInsertStatements(
			db,
			tableName("organizations"),
			[
				"id",
				"name",
				"public_key",
				"private_key",
				"deletion_requested_at",
				"created_at",
				"updated_at",
			],
			payload.organizations || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("org_members"),
		buildInsertStatements(
			db,
			tableName("org_members"),
			[
				"id",
				"org_id",
				"user_id",
				"email",
				"key",
				"role",
				"status",
				"access_all",
				"created_at",
				"updated_at",
			],
			payload.org_members || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("collections"),
		buildInsertStatements(
			db,
			tableName("collections"),
			["id", "org_id", "name", "created_at", "updated_at"],
			payload.collections || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("collection_members"),
		buildInsertStatements(
			db,
			tableName("collection_members"),
			[
				"collection_id",
				"org_member_id",
				"read_only",
				"hide_passwords",
				"manage",
			],
			payload.collection_members || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("webauthn_credentials"),
		buildInsertStatements(
			db,
			tableName("webauthn_credentials"),
			[
				"id",
				"user_id",
				"name",
				"public_key",
				"credential_id",
				"counter",
				"type",
				"aa_guid",
				"transports",
				"encrypted_user_key",
				"encrypted_public_key",
				"encrypted_private_key",
				"supports_prf",
				"created_at",
				"updated_at",
			],
			payload.webauthn_credentials || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("folders"),
		buildInsertStatements(
			db,
			tableName("folders"),
			["id", "user_id", "name", "created_at", "updated_at"],
			payload.folders || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("ciphers"),
		buildInsertStatements(
			db,
			tableName("ciphers"),
			[
				"id",
				"user_id",
				"org_id",
				"type",
				"folder_id",
				"name",
				"notes",
				"fields",
				"password_history",
				"favorite",
				"data",
				"reprompt",
				"key",
				"created_at",
				"updated_at",
				"archived_at",
				"deleted_at",
				"purge_after",
			],
			payload.ciphers || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("cipher_user_settings"),
		buildInsertStatements(
			db,
			tableName("cipher_user_settings"),
			[
				"cipher_id",
				"user_id",
				"folder_id",
				"favorite",
				"archived_at",
				"updated_at",
			],
			payload.cipher_user_settings || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("cipher_collections"),
		buildInsertStatements(
			db,
			tableName("cipher_collections"),
			["cipher_id", "collection_id"],
			payload.cipher_collections || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("attachments"),
		buildInsertStatements(
			db,
			tableName("attachments"),
			[
				"id",
				"cipher_id",
				"file_name",
				"size",
				"size_name",
				"key",
				"created_at",
				"storage_key",
				"deleted_at",
			],
			payload.attachments || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("sends"),
		buildInsertStatements(
			db,
			tableName("sends"),
			[
				"id",
				"user_id",
				"org_id",
				"type",
				"key",
				"name",
				"notes",
				"deletion_date",
				"expiration_date",
				"disabled",
				"max_access_count",
				"access_count",
				"password_hash",
				"password_salt",
				"password_iterations",
				"password_algorithm",
				"auth_type",
				"emails",
				"hide_email",
				"data",
				"created_at",
				"updated_at",
				"storage_key",
			],
			payload.sends || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("audit_logs"),
		buildInsertStatements(
			db,
			tableName("audit_logs"),
			[
				"id",
				"actor_user_id",
				"action",
				"category",
				"level",
				"target_type",
				"target_id",
				"metadata",
				"is_tombstone",
				"created_at",
			],
			payload.audit_logs || [],
		),
	);
}
