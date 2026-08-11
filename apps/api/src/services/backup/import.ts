import type { BlobStore } from "../blob-store";
import {
	type BackupPayload,
	parseBackupArchive,
} from "./archive";
import {
	BACKUP_SETTINGS_CONFIG_KEY,
	normalizeImportedBackupSettingsValue,
} from "./config";

type SqlRow = Record<string, string | number | null>;
type BackupTableName =
	| "config"
	| "users"
	| "domain_settings"
	| "user_revisions"
	| "folders"
	| "ciphers"
	| "attachments"
	| "webauthn_credentials"
	| "device_trust_tokens"
	| "sends";

const BACKUP_TABLES: BackupTableName[] = [
	"config",
	"users",
	"domain_settings",
	"user_revisions",
	"folders",
	"ciphers",
	"attachments",
	"webauthn_credentials",
	"device_trust_tokens",
	"sends",
];

function shadowTableName(table: BackupTableName): string {
	return `${table}__restore`;
}

export interface BackupImportResultBody {
	object: "instance-backup-import";
	imported: {
		config: number;
		users: number;
		domainSettings: number;
		userRevisions: number;
		folders: number;
		ciphers: number;
		attachments: number;
		webauthnCredentials: number;
		deviceTrustTokens: number;
		sends: number;
		attachmentFiles: number;
	};
	skipped: {
		reason: string | null;
		attachments: number;
		items: Array<{
			kind: "attachment";
			path: string;
			sizeBytes: number;
		}>;
	};
}

export interface BackupImportExecutionResult {
	result: BackupImportResultBody;
	auditActorUserId: string | null;
}

async function queryRows(
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

function buildShadowTableCreateSql(
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

async function resetRestoreArtifacts(db: D1Database): Promise<void> {
	const dropStatements = BACKUP_TABLES.slice()
		.reverse()
		.map((table) =>
			db.prepare(`DROP TABLE IF EXISTS ${shadowTableName(table)}`),
		);
	if (dropStatements.length) {
		await db.batch(dropStatements);
	}
}

async function createShadowTables(db: D1Database): Promise<void> {
	const createStatements: D1PreparedStatement[] = [];
	for (const table of BACKUP_TABLES) {
		const createSql = await getTableCreateSql(db, table);
		createStatements.push(
			db.prepare(buildShadowTableCreateSql(createSql, table)),
		);
	}
	await db.batch(createStatements);
}

async function validateShadowTableCounts(
	db: D1Database,
	expectedCounts: Partial<Record<BackupTableName, number>>,
): Promise<void> {
	await Promise.all(
		BACKUP_TABLES.map(async (table) => {
			const expected = expectedCounts[table] ?? 0;
			const row = await db
				.prepare(`SELECT COUNT(*) AS count FROM ${shadowTableName(table)}`)
				.first<{ count: number }>();
			const actual = Number(row?.count || 0);
			if (actual !== expected) {
				throw new Error(
					`Restore shadow validation failed for ${table}: expected ${expected}, received ${actual}`,
				);
			}
		}),
	);
}

async function swapShadowTablesIntoPlace(db: D1Database): Promise<void> {
	const statements: D1PreparedStatement[] = [];
	for (const sql of buildResetImportTargetStatements(db)) {
		statements.push(sql);
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

async function ensureImportTargetIsFresh(db: D1Database): Promise<void> {
	const counts = await Promise.all([
		db
			.prepare("SELECT COUNT(*) AS count FROM ciphers")
			.first<{ count: number }>(),
		db
			.prepare("SELECT COUNT(*) AS count FROM folders")
			.first<{ count: number }>(),
		db
			.prepare("SELECT COUNT(*) AS count FROM attachments")
			.first<{ count: number }>(),
		db
			.prepare("SELECT COUNT(*) AS count FROM sends")
			.first<{ count: number }>(),
	]);
	const total = counts.reduce((sum, row) => sum + Number(row?.count || 0), 0);
	if (total > 0) {
		throw new Error(
			"Backup import requires a fresh instance with no vault or send data",
		);
	}
}

function buildResetImportTargetStatements(
	db: D1Database,
): D1PreparedStatement[] {
	return [
		"DELETE FROM sends",
		"DELETE FROM attachments",
		"DELETE FROM ciphers",
		"DELETE FROM folders",
		"DELETE FROM webauthn_credentials",
		"DELETE FROM device_trust_tokens",
		"DELETE FROM domain_settings",
		"DELETE FROM user_revisions",
		"DELETE FROM users",
		"DELETE FROM config",
	].map((sql) => db.prepare(sql));
}

async function collectCurrentBlobKeys(db: D1Database): Promise<Set<string>> {
	const keys = new Set<string>();
	const attachmentRows = await queryRows(
		db,
		`SELECT a.id, a.cipher_id
     FROM attachments a
     INNER JOIN ciphers c ON c.id = a.cipher_id`,
	);
	for (const row of attachmentRows) {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		if (!cipherId || !attachmentId) continue;
		keys.add(`attachments/${cipherId}/${attachmentId}.bin`);
	}
	return keys;
}

const KV_BLOB_SKIP_REASON = "Cloudflare KV object size limit (25 MB)";
const BLOB_STORAGE_UNAVAILABLE_SKIP_REASON =
	"Attachment storage is not configured";
const ATTACHMENT_RESTORE_FAILED_REASON =
	"Some attachments could not be restored and were skipped";

interface BackupImportSkipSummary {
	reason: string | null;
	attachments: number;
	items: Array<{
		kind: "attachment";
		path: string;
		sizeBytes: number;
	}>;
}

interface PreparedBackupImportPayload {
	payload: BackupPayload;
	skipped: BackupImportSkipSummary;
}

interface AttachmentRestoreResult {
	imported: number;
	restoredAttachments: SqlRow[];
	skipped: BackupImportSkipSummary;
}

export interface BackupRestoreProgressEvent {
	source: "local" | "remote";
	step: string;
	fileName: string;
	stageTitle: string;
	stageDetail: string;
	replaceExisting: boolean;
	done?: boolean;
	ok?: boolean;
	error?: string | null;
}

export type BackupRestoreProgressReporter = (
	event: BackupRestoreProgressEvent,
) => Promise<void> | void;

function attachmentRowKey(row: SqlRow): string {
	const attachmentId = String(row.id || "").trim();
	const cipherId = String(row.cipher_id || "").trim();
	return `${cipherId}/${attachmentId}`;
}

function cloneRows(rows: SqlRow[]): SqlRow[] {
	return rows.map((row) => ({ ...row }));
}

function upsertConfigRow(rows: SqlRow[], key: string, value: string): SqlRow[] {
	let replaced = false;
	const nextRows = rows.map((row) => {
		if (String(row.key || "").trim() !== key) return { ...row };
		replaced = true;
		return { ...row, key, value };
	});
	if (!replaced) {
		nextRows.push({ key, value });
	}
	return nextRows;
}

async function prepareImportedConfigRows(
	jwtSecret: string,
	configRows: SqlRow[],
	userRows: SqlRow[],
): Promise<SqlRow[]> {
	let nextConfigRows = cloneRows(configRows || []);
	const rawBackupSettings = nextConfigRows.find(
		(row) => String(row.key || "").trim() === BACKUP_SETTINGS_CONFIG_KEY,
	);
	const normalizedBackupSettings = await normalizeImportedBackupSettingsValue(
		typeof rawBackupSettings?.value === "string"
			? rawBackupSettings.value
			: null,
		jwtSecret,
		userRows.map((row) => ({
			id: String(row.id || "").trim(),
			public_key: typeof row.public_key === "string" ? row.public_key : null,
			role: String(row.role || "").trim(),
			status: String(row.status || "").trim(),
		})),
		"UTC",
	);
	if (normalizedBackupSettings !== null) {
		nextConfigRows = upsertConfigRow(
			nextConfigRows,
			BACKUP_SETTINGS_CONFIG_KEY,
			normalizedBackupSettings,
		);
	}
	nextConfigRows = upsertConfigRow(nextConfigRows, "registered", "true");
	return nextConfigRows;
}

async function importPreparedBackupRows(
	db: D1Database,
	payload: BackupPayload["db"],
	jwtSecret: string,
): Promise<BackupPayload["db"]> {
	const preparedDb: BackupPayload["db"] = {
		config: await prepareImportedConfigRows(
			jwtSecret,
			payload.config || [],
			payload.users || [],
		),
		users: cloneRows(payload.users || []).map((row) => ({
			...row,
			verify_devices: row.verify_devices ?? 1,
		})),
		domain_settings: cloneRows(payload.domain_settings || []),
		user_revisions: cloneRows(payload.user_revisions || []),
		device_trust_tokens: cloneRows(payload.device_trust_tokens || []),
		webauthn_credentials: cloneRows(payload.webauthn_credentials || []),
		folders: cloneRows(payload.folders || []),
		ciphers: cloneRows(payload.ciphers || []).map((row) => ({
			...row,
			archived_at: row.archived_at ?? null,
		})),
		attachments: cloneRows(payload.attachments || []),
		sends: cloneRows(payload.sends || []),
	};
	await importBackupRows(db, preparedDb, true);
	return preparedDb;
}

function prepareImportPayloadForTarget(
	blobStore: BlobStore | null,
	payload: BackupPayload,
	files: Record<string, Uint8Array>,
): PreparedBackupImportPayload {
	if (!blobStore) {
		const skippedItems = (payload.db.attachments || []).map((row) => {
			const cipherId = String(row.cipher_id || "").trim();
			const attachmentId = String(row.id || "").trim();
			return {
				kind: "attachment" as const,
				path: `attachments/${cipherId}/${attachmentId}.bin`,
				sizeBytes: Number(row.size || 0) || 0,
			};
		});

		return {
			payload: {
				...payload,
				db: {
					...payload.db,
					attachments: [],
				},
			},
			skipped: {
				reason: skippedItems.length
					? BLOB_STORAGE_UNAVAILABLE_SKIP_REASON
					: null,
				attachments: skippedItems.length,
				items: skippedItems,
			},
		};
	}

	const oversizedAttachmentPaths = new Set<string>();
	const skippedItems: BackupImportSkipSummary["items"] = [];

	for (const entry of Object.keys(files)) {
		if (!entry.endsWith(".bin")) continue;
		const sizeBytes = files[entry].byteLength;
		if (
			blobStore.maxObjectBytes === null ||
			sizeBytes <= blobStore.maxObjectBytes
		)
			continue;
		if (entry.startsWith("attachments/")) {
			oversizedAttachmentPaths.add(entry);
			skippedItems.push({ kind: "attachment", path: entry, sizeBytes });
		}
	}

	const nextAttachments = (payload.db.attachments || []).filter((row) => {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		if (!cipherId || !attachmentId) return false;
		return !oversizedAttachmentPaths.has(
			`attachments/${cipherId}/${attachmentId}.bin`,
		);
	});

	return {
		payload: {
			...payload,
			db: {
				...payload.db,
				attachments: nextAttachments,
			},
		},
		skipped: {
			reason: skippedItems.length ? KV_BLOB_SKIP_REASON : null,
			attachments: skippedItems.length,
			items: skippedItems,
		},
	};
}

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

async function restoreBlobFiles(
	blobStore: BlobStore | null,
	db: BackupPayload["db"],
	files: Record<string, Uint8Array>,
): Promise<AttachmentRestoreResult> {
	const restoredAttachments: SqlRow[] = [];
	const skippedItems: BackupImportSkipSummary["items"] = [];

	if (!blobStore) {
		return {
			imported: 0,
			restoredAttachments: [],
			skipped: {
				reason: BLOB_STORAGE_UNAVAILABLE_SKIP_REASON,
				attachments: (db.attachments || []).length,
				items: (db.attachments || []).map((row) => ({
					kind: "attachment",
					path: `attachments/${row.cipher_id}/${row.id}.bin`,
					sizeBytes: Number(row.size || 0),
				})),
			},
		};
	}

	for (const row of db.attachments || []) {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		if (!cipherId || !attachmentId) continue;
		const key = `attachments/${cipherId}/${attachmentId}.bin`;
		const bytes = files[key];
		if (!bytes) {
			skippedItems.push({
				kind: "attachment",
				path: key,
				sizeBytes: Number(row.size || 0) || 0,
			});
			continue;
		}
		try {
			await blobStore.put(key, bytes, {
				size: bytes.byteLength,
				contentType: "application/octet-stream",
			});
			restoredAttachments.push(row);
		} catch {
			skippedItems.push({
				kind: "attachment",
				path: key,
				sizeBytes: bytes.byteLength,
			});
		}
	}

	return {
		imported: restoredAttachments.length,
		restoredAttachments,
		skipped: {
			reason: skippedItems.length ? ATTACHMENT_RESTORE_FAILED_REASON : null,
			attachments: skippedItems.length,
			items: skippedItems,
		},
	};
}

async function removeAttachmentRows(
	db: D1Database,
	attachmentRows: SqlRow[],
	useShadowTable = false,
): Promise<void> {
	if (!attachmentRows.length) return;
	const tableName = useShadowTable
		? shadowTableName("attachments")
		: "attachments";
	const statements = attachmentRows
		.map((row) => {
			const attachmentId = String(row.id || "").trim();
			const cipherId = String(row.cipher_id || "").trim();
			if (!attachmentId || !cipherId) return null;
			return db
				.prepare(`DELETE FROM ${tableName} WHERE id = ? AND cipher_id = ?`)
				.bind(attachmentId, cipherId);
		})
		.filter((statement): statement is D1PreparedStatement => !!statement);
	if (!statements.length) return;
	await db.batch(statements);
}

async function cleanupOrphanedBlobFiles(
	blobStore: BlobStore | null,
	beforeKeys: Set<string>,
	afterKeys: Set<string>,
): Promise<void> {
	if (!blobStore) return;
	const staleKeys = Array.from(beforeKeys).filter((key) => !afterKeys.has(key));
	for (const key of staleKeys) {
		await blobStore.delete(key);
	}
}

async function importBackupRows(
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
				"kdf_type",
				"kdf_iterations",
				"kdf_memory",
				"kdf_parallelism",
				"security_stamp",
				"role",
				"status",
				"verify_devices",
				"totp_secret",
				"totp_recovery_code",
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
		tableName("device_trust_tokens"),
		buildInsertStatements(
			db,
			tableName("device_trust_tokens"),
			["token", "user_id", "device_identifier", "expires_at"],
			payload.device_trust_tokens || [],
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
				"type",
				"folder_id",
				"name",
				"notes",
				"favorite",
				"data",
				"reprompt",
				"key",
				"created_at",
				"updated_at",
				"archived_at",
				"deleted_at",
			],
			payload.ciphers || [],
		),
	);
	await runInsertBatch(
		db,
		tableName("attachments"),
		buildInsertStatements(
			db,
			tableName("attachments"),
			["id", "cipher_id", "file_name", "size", "size_name", "key"],
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
			],
			payload.sends || [],
		),
	);
}

export async function importBackupArchiveBytes(
	archiveBytes: Uint8Array,
	dbBinding: D1Database,
	blobStore: BlobStore | null,
	jwtSecret: string,
	actorUserId: string,
	replaceExisting: boolean,
	progress?: BackupRestoreProgressReporter,
	fileName = "edgewarden_backup.zip",
): Promise<BackupImportExecutionResult> {
	const parsed = parseBackupArchive(archiveBytes);
	// Validate database format: if sends are missing or webauthn credentials are not in payload, fallback or add defaults
	if (!parsed.payload.db.sends) {
		parsed.payload.db.sends = [];
	}
	if (!parsed.payload.db.device_trust_tokens) {
		parsed.payload.db.device_trust_tokens = [];
	}
	if (!parsed.payload.db.webauthn_credentials) {
		parsed.payload.db.webauthn_credentials = [];
	}

	const prepared = prepareImportPayloadForTarget(
		blobStore,
		parsed.payload,
		parsed.files,
	);

	try {
		await ensureImportTargetIsFresh(dbBinding);
	} catch (error) {
		if (!replaceExisting) {
			throw error instanceof Error
				? error
				: new Error("Backup import requires a fresh instance");
		}
	}

	await resetRestoreArtifacts(dbBinding);
	const previousBlobKeys = replaceExisting
		? await collectCurrentBlobKeys(dbBinding)
		: new Set<string>();
	try {
		await progress?.({
			source: "local",
			step: "local_create_shadow",
			fileName,
			stageTitle: "txt_backup_restore_progress_local_shadow_title",
			stageDetail: "txt_backup_restore_progress_local_shadow_detail",
			replaceExisting,
		});
		await createShadowTables(dbBinding);
		await progress?.({
			source: "local",
			step: "local_import_data",
			fileName,
			stageTitle: "txt_backup_restore_progress_local_data_title",
			stageDetail: "txt_backup_restore_progress_local_data_detail",
			replaceExisting,
		});
		const db = await importPreparedBackupRows(
			dbBinding,
			prepared.payload.db,
			jwtSecret,
		);
		await validateShadowTableCounts(dbBinding, {
			config: (db.config || []).length,
			users: (db.users || []).length,
			domain_settings: (db.domain_settings || []).length,
			user_revisions: (db.user_revisions || []).length,
			device_trust_tokens: (db.device_trust_tokens || []).length,
			webauthn_credentials: (db.webauthn_credentials || []).length,
			folders: (db.folders || []).length,
			ciphers: (db.ciphers || []).length,
			attachments: (db.attachments || []).length,
			sends: (db.sends || []).length,
		});

		await progress?.({
			source: "local",
			step: "local_restore_files",
			fileName,
			stageTitle: "txt_backup_restore_progress_local_files_title",
			stageDetail: "txt_backup_restore_progress_local_files_detail",
			replaceExisting,
		});
		const restored = await restoreBlobFiles(blobStore, db, parsed.files);
		const restoredAttachmentKeys = new Set(
			(restored.restoredAttachments || []).map(attachmentRowKey),
		);
		const failedRestoreRows = (db.attachments || []).filter(
			(row) => !restoredAttachmentKeys.has(attachmentRowKey(row)),
		);
		await removeAttachmentRows(dbBinding, failedRestoreRows, true).catch(
			() => undefined,
		);
		await validateShadowTableCounts(dbBinding, {
			config: (db.config || []).length,
			users: (db.users || []).length,
			domain_settings: (db.domain_settings || []).length,
			user_revisions: (db.user_revisions || []).length,
			device_trust_tokens: (db.device_trust_tokens || []).length,
			webauthn_credentials: (db.webauthn_credentials || []).length,
			folders: (db.folders || []).length,
			ciphers: (db.ciphers || []).length,
			attachments: restored.restoredAttachments.length,
			sends: (db.sends || []).length,
		});
		await progress?.({
			source: "local",
			step: "local_finalize",
			fileName,
			stageTitle: "txt_backup_restore_progress_local_finalize_title",
			stageDetail: "txt_backup_restore_progress_local_finalize_detail",
			replaceExisting,
		});
		await swapShadowTablesIntoPlace(dbBinding);
		await resetRestoreArtifacts(dbBinding).catch(() => undefined);
		if (replaceExisting && previousBlobKeys.size) {
			const nextBlobKeys = await collectCurrentBlobKeys(dbBinding).catch(
				() => null,
			);
			if (nextBlobKeys) {
				await cleanupOrphanedBlobFiles(
					blobStore,
					previousBlobKeys,
					nextBlobKeys,
				).catch(() => undefined);
			}
		}

		await progress?.({
			source: "local",
			step: "local_complete",
			fileName,
			stageTitle: "txt_backup_restore_progress_local_finalize_title",
			stageDetail: "txt_backup_restore_progress_local_finalize_detail",
			replaceExisting,
			done: true,
			ok: true,
		});
		return {
			auditActorUserId: (db.users || []).some(
				(row) => String(row.id || "").trim() === actorUserId,
			)
				? actorUserId
				: null,
			result: {
				object: "instance-backup-import",
				imported: {
					config: (db.config || []).length,
					users: (db.users || []).length,
					domainSettings: (db.domain_settings || []).length,
					userRevisions: (db.user_revisions || []).length,
					folders: (db.folders || []).length,
					ciphers: (db.ciphers || []).length,
					attachments: restored.restoredAttachments.length,
					webauthnCredentials: (db.webauthn_credentials || []).length,
					deviceTrustTokens: (db.device_trust_tokens || []).length,
					sends: (db.sends || []).length,
					attachmentFiles: restored.restoredAttachments.length,
				},
				skipped: restored.skipped,
			},
		};
	} catch (error) {
		await resetRestoreArtifacts(dbBinding).catch(() => undefined);
		await progress?.({
			source: "local",
			step: "local_failed",
			fileName,
			stageTitle: "txt_backup_restore_progress_local_finalize_title",
			stageDetail: "txt_backup_restore_progress_local_finalize_detail",
			replaceExisting,
			done: true,
			ok: false,
			error: error instanceof Error ? error.message : "Restore failed",
		});
		throw error;
	}
}

export async function importRemoteBackupArchiveBytes(
	archiveBytes: Uint8Array,
	dbBinding: D1Database,
	blobStore: BlobStore | null,
	jwtSecret: string,
	actorUserId: string,
	replaceExisting: boolean,
	source: { loadAttachment: (blobName: string) => Promise<Uint8Array | null> },
	progress?: BackupRestoreProgressReporter,
	fileName = "edgewarden_backup.zip",
): Promise<BackupImportExecutionResult> {
	const parsed = parseBackupArchive(archiveBytes);
	if (!parsed.payload.db.sends) {
		parsed.payload.db.sends = [];
	}
	if (!parsed.payload.db.device_trust_tokens) {
		parsed.payload.db.device_trust_tokens = [];
	}
	if (!parsed.payload.db.webauthn_credentials) {
		parsed.payload.db.webauthn_credentials = [];
	}

	const storageKind = blobStore?.kind ?? null;
	const nextAttachments: SqlRow[] = [];
	const skippedItems: BackupImportSkipSummary["items"] = [];

	for (const row of parsed.payload.db.attachments || []) {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		const sizeBytes = Number(row.size || 0);
		const path = `attachments/${cipherId}/${attachmentId}.bin`;
		if (parsed.files[path]) {
			nextAttachments.push(row);
			continue;
		}
		if (
			blobStore?.maxObjectBytes !== null &&
			blobStore?.maxObjectBytes !== undefined &&
			sizeBytes > blobStore.maxObjectBytes
		) {
			skippedItems.push({ kind: "attachment", path, sizeBytes });
			continue;
		}
		if (storageKind === null) {
			skippedItems.push({ kind: "attachment", path, sizeBytes });
			continue;
		}
		nextAttachments.push(row);
	}

	const preparedPayload = {
		...parsed.payload,
		db: {
			...parsed.payload.db,
			attachments: nextAttachments,
		},
	};

	try {
		await ensureImportTargetIsFresh(dbBinding);
	} catch (error) {
		if (!replaceExisting) {
			throw error instanceof Error
				? error
				: new Error("Backup import requires a fresh instance");
		}
	}

	await resetRestoreArtifacts(dbBinding);
	const previousBlobKeys = replaceExisting
		? await collectCurrentBlobKeys(dbBinding)
		: new Set<string>();

	try {
		await progress?.({
			source: "remote",
			step: "remote_create_shadow",
			fileName,
			stageTitle: "txt_backup_restore_progress_remote_shadow_title",
			stageDetail: "txt_backup_restore_progress_remote_shadow_detail",
			replaceExisting,
		});
		await createShadowTables(dbBinding);
		await progress?.({
			source: "remote",
			step: "remote_import_data",
			fileName,
			stageTitle: "txt_backup_restore_progress_remote_data_title",
			stageDetail: "txt_backup_restore_progress_remote_data_detail",
			replaceExisting,
		});
		const db = await importPreparedBackupRows(
			dbBinding,
			preparedPayload.db,
			jwtSecret,
		);
		await validateShadowTableCounts(dbBinding, {
			config: (db.config || []).length,
			users: (db.users || []).length,
			domain_settings: (db.domain_settings || []).length,
			user_revisions: (db.user_revisions || []).length,
			device_trust_tokens: (db.device_trust_tokens || []).length,
			webauthn_credentials: (db.webauthn_credentials || []).length,
			folders: (db.folders || []).length,
			ciphers: (db.ciphers || []).length,
			attachments: (db.attachments || []).length,
			sends: (db.sends || []).length,
		});

		await progress?.({
			source: "remote",
			step: "remote_restore_files",
			fileName,
			stageTitle: "txt_backup_restore_progress_remote_files_title",
			stageDetail: "txt_backup_restore_progress_remote_files_detail",
			replaceExisting,
		});

		const restoredAttachments: SqlRow[] = [];
		if (blobStore) {
			for (const row of db.attachments || []) {
				const cipherId = String(row.cipher_id || "").trim();
				const attachmentId = String(row.id || "").trim();
				const key = `attachments/${cipherId}/${attachmentId}.bin`;
				const bytes =
					parsed.files[key] ||
					(await source.loadAttachment(key).catch(() => null));
				if (!bytes) {
					skippedItems.push({
						kind: "attachment",
						path: key,
						sizeBytes: Number(row.size || 0),
					});
					continue;
				}
				try {
					await blobStore.put(key, bytes, {
						size: bytes.byteLength,
						contentType: "application/octet-stream",
					});
					restoredAttachments.push(row);
				} catch {
					skippedItems.push({
						kind: "attachment",
						path: key,
						sizeBytes: bytes.byteLength,
					});
				}
			}
		}

		const restoredAttachmentKeys = new Set(
			restoredAttachments.map(attachmentRowKey),
		);
		const failedRestoreRows = (db.attachments || []).filter(
			(row) => !restoredAttachmentKeys.has(attachmentRowKey(row)),
		);
		await removeAttachmentRows(dbBinding, failedRestoreRows, true).catch(
			() => undefined,
		);
		await validateShadowTableCounts(dbBinding, {
			config: (db.config || []).length,
			users: (db.users || []).length,
			domain_settings: (db.domain_settings || []).length,
			user_revisions: (db.user_revisions || []).length,
			device_trust_tokens: (db.device_trust_tokens || []).length,
			webauthn_credentials: (db.webauthn_credentials || []).length,
			folders: (db.folders || []).length,
			ciphers: (db.ciphers || []).length,
			attachments: restoredAttachments.length,
			sends: (db.sends || []).length,
		});

		await progress?.({
			source: "remote",
			step: "remote_finalize",
			fileName,
			stageTitle: "txt_backup_restore_progress_remote_finalize_title",
			stageDetail: "txt_backup_restore_progress_remote_finalize_detail",
			replaceExisting,
		});
		await swapShadowTablesIntoPlace(dbBinding);
		await resetRestoreArtifacts(dbBinding).catch(() => undefined);
		if (replaceExisting && previousBlobKeys.size) {
			const nextBlobKeys = await collectCurrentBlobKeys(dbBinding).catch(
				() => null,
			);
			if (nextBlobKeys) {
				await cleanupOrphanedBlobFiles(
					blobStore,
					previousBlobKeys,
					nextBlobKeys,
				).catch(() => undefined);
			}
		}

		await progress?.({
			source: "remote",
			step: "remote_complete",
			fileName,
			stageTitle: "txt_backup_restore_progress_remote_finalize_title",
			stageDetail: "txt_backup_restore_progress_remote_finalize_detail",
			replaceExisting,
			done: true,
			ok: true,
		});

		return {
			auditActorUserId: (db.users || []).some(
				(row) => String(row.id || "").trim() === actorUserId,
			)
				? actorUserId
				: null,
			result: {
				object: "instance-backup-import",
				imported: {
					config: (db.config || []).length,
					users: (db.users || []).length,
					domainSettings: (db.domain_settings || []).length,
					userRevisions: (db.user_revisions || []).length,
					folders: (db.folders || []).length,
					ciphers: (db.ciphers || []).length,
					attachments: restoredAttachments.length,
					webauthnCredentials: (db.webauthn_credentials || []).length,
					deviceTrustTokens: (db.device_trust_tokens || []).length,
					sends: (db.sends || []).length,
					attachmentFiles: restoredAttachments.length,
				},
				skipped: {
					reason: skippedItems.length ? ATTACHMENT_RESTORE_FAILED_REASON : null,
					attachments: skippedItems.length,
					items: skippedItems,
				},
			},
		};
	} catch (error) {
		await resetRestoreArtifacts(dbBinding).catch(() => undefined);
		await progress?.({
			source: "remote",
			step: "remote_failed",
			fileName,
			stageTitle: "txt_backup_restore_progress_remote_finalize_title",
			stageDetail: "txt_backup_restore_progress_remote_finalize_detail",
			replaceExisting,
			done: true,
			ok: false,
			error: error instanceof Error ? error.message : "Restore failed",
		});
		throw error;
	}
}
