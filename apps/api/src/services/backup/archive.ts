import { unzipSync, zipSync } from "fflate";
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { BlobStore } from "../blob-store";
import { BACKUP_SETTINGS_CONFIG_KEY } from "./config";
import { EDGEWARDEN_VERSION } from "@edgewarden/shared";
import { exportPortableBackupSettingsEnvelope } from "./settings-crypto";

type SqlRow = Record<string, string | number | null>;

const BACKUP_FORMAT_VERSION = 1;
const BACKUP_RUNNER_LOCK_CONFIG_KEY = "backup.runner.lock.v1";
const BACKUP_FILE_HASH_PREFIX_LENGTH = 5;
const BACKUP_TEXT_COMPRESSION_LEVEL = 0;
const BACKUP_JSON_INDENT = 2;
const MAX_BACKUP_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_ARCHIVE_ENTRY_COUNT = 10000;
const MAX_BACKUP_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_DB_JSON_BYTES = 32 * 1024 * 1024;

export interface BackupManifest {
	formatVersion: 1;
	exportedAt: string;
	appVersion: string;
	storageKind: "kv" | "r2" | null;
	tableCounts: Record<string, number>;
	includes: {
		attachments: boolean;
	};
	blobSummary: {
		attachmentFiles: number;
		totalBytes: number;
		largestObjectBytes: number;
	};
	attachmentBlobs?: BackupManifestAttachmentBlob[];
}

export interface BackupManifestAttachmentBlob {
	cipherId: string;
	attachmentId: string;
	blobName: string;
	sizeBytes: number;
}

export interface BackupPayload {
	manifest: BackupManifest;
	db: {
		config: SqlRow[];
		users: SqlRow[];
		domain_settings: SqlRow[];
		user_revisions: SqlRow[];
		organizations?: SqlRow[];
		org_members?: SqlRow[];
		collections?: SqlRow[];
		collection_members?: SqlRow[];
		folders: SqlRow[];
		ciphers: SqlRow[];
		cipher_collections?: SqlRow[];
		attachments: SqlRow[];
		webauthn_credentials?: SqlRow[];
		device_trust_tokens?: SqlRow[];
		sends?: SqlRow[];
	};
}

function sanitizeUserRowsForExport(rows: SqlRow[]): SqlRow[] {
	return rows.map(
		({
			api_key_hash: _apiKeyHash,
			api_key_encrypted: _apiKeyEncrypted,
			...row
		}) => row,
	);
}

export interface BackupArchiveBundle {
	bytes: Uint8Array;
	fileName: string;
	manifest: BackupManifest;
}

export interface BackupFileIntegrityCheckResult {
	hasChecksumPrefix: boolean;
	expectedPrefix: string | null;
	actualPrefix: string;
	matches: boolean;
}

export interface BuildBackupArchiveOptions {
	includeAttachments?: boolean;
	blobStore?: BlobStore | null;
	progress?: BackupArchiveBuildProgressReporter;
	timeZone?: string;
}

export interface BackupArchiveBuildProgressEvent {
	step: string;
	fileName?: string;
	stageTitle: string;
	stageDetail: string;
	includeAttachments: boolean;
}

export type BackupArchiveBuildProgressReporter = (
	event: BackupArchiveBuildProgressEvent,
) => Promise<void>;

function sanitizeConfigRowsForExport(rows: SqlRow[]): SqlRow[] {
	const sanitized: SqlRow[] = [];
	for (const row of rows) {
		const key = String(row.key || "").trim();
		if (!key || key === BACKUP_RUNNER_LOCK_CONFIG_KEY) continue;

		if (key === BACKUP_SETTINGS_CONFIG_KEY) {
			const portableOnly = exportPortableBackupSettingsEnvelope(
				typeof row.value === "string" ? row.value : null,
			);
			if (portableOnly) sanitized.push({ ...row, value: portableOnly });
			continue;
		}

		sanitized.push({ ...row });
	}
	return sanitized;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function getDateParts(date: Date, timeZone: string): string {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const parts = formatter.formatToParts(date);
	const pick = (type: string): string =>
		parts.find((part) => part.type === type)?.value || "";
	return `${pick("year")}${pick("month")}${pick("day")}_${pick("hour")}${pick("minute")}${pick("second")}`;
}

function buildBackupFileNameInTimeZone(
	date: Date = new Date(),
	checksumPrefix: string | null = null,
	timeZone = "UTC",
): string {
	const parts = getDateParts(date, timeZone);
	const suffix = checksumPrefix ? `_${checksumPrefix}` : "";
	return `edgewarden_backup_${parts}${suffix}.zip`;
}

export function extractBackupFileChecksumPrefix(
	fileName: string,
): string | null {
	const normalized = String(fileName || "").trim();
	const match = normalized.match(/_([0-9a-f]{5})\.zip$/i);
	return match ? match[1].toLowerCase() : null;
}

export async function inspectBackupArchiveFileNameChecksum(
	bytes: Uint8Array,
	fileName: string,
): Promise<BackupFileIntegrityCheckResult> {
	const expectedPrefix = extractBackupFileChecksumPrefix(fileName);
	const actualHash = await sha256Hex(bytes);
	const actualPrefix = actualHash.slice(0, BACKUP_FILE_HASH_PREFIX_LENGTH);
	return {
		hasChecksumPrefix: !!expectedPrefix,
		expectedPrefix,
		actualPrefix,
		matches: !expectedPrefix || actualPrefix === expectedPrefix,
	};
}

export async function verifyBackupArchiveFileNameChecksum(
	bytes: Uint8Array,
	fileName: string,
): Promise<boolean> {
	const result = await inspectBackupArchiveFileNameChecksum(bytes, fileName);
	return result.matches;
}

function validateArchiveSize(bytes: Uint8Array): void {
	if (bytes.byteLength > MAX_BACKUP_ARCHIVE_BYTES) {
		throw new Error(
			`Backup archive is too large. The current restore limit is ${Math.floor(MAX_BACKUP_ARCHIVE_BYTES / (1024 * 1024))} MiB`,
		);
	}
}

function getRequiredZipEntries(db: BackupPayload["db"]): string[] {
	const entries: string[] = [];
	for (const row of db.attachments) {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		if (!cipherId || !attachmentId) continue;
		entries.push(`attachments/${cipherId}/${attachmentId}.bin`);
	}
	return entries;
}

function createZipEntries(
	files: Record<string, Uint8Array>,
): Record<string, Uint8Array | [Uint8Array, { level: 0 | 1 | 6 }]> {
	const entries: Record<
		string,
		Uint8Array | [Uint8Array, { level: 0 | 1 | 6 }]
	> = {};
	for (const [path, bytes] of Object.entries(files)) {
		entries[path] = [bytes, { level: BACKUP_TEXT_COMPRESSION_LEVEL }];
	}
	return entries;
}

export interface ParseBackupArchiveOptions {
	allowExternalAttachmentBlobs?: boolean;
}

export function parseBackupArchive(
	bytes: Uint8Array,
	options: ParseBackupArchiveOptions = {},
): { payload: BackupPayload; files: Record<string, Uint8Array> } {
	validateArchiveSize(bytes);
	let zipped: Record<string, Uint8Array>;
	try {
		zipped = unzipSync(bytes);
	} catch {
		throw new Error("Invalid backup archive");
	}

	const entryNames = Object.keys(zipped);
	if (entryNames.length > MAX_BACKUP_ARCHIVE_ENTRY_COUNT) {
		throw new Error("Backup archive contains too many files");
	}

	let totalExtractedBytes = 0;
	for (const entry of entryNames) {
		const entryBytes = zipped[entry];
		totalExtractedBytes += entryBytes.byteLength;
		if (
			entry === "db.json" &&
			entryBytes.byteLength > MAX_BACKUP_DB_JSON_BYTES
		) {
			throw new Error("Backup archive database payload is too large");
		}
		if (totalExtractedBytes > MAX_BACKUP_EXTRACTED_BYTES) {
			throw new Error(
				"Backup archive expands beyond the current restore limit",
			);
		}
	}

	const manifestBytes = zipped["manifest.json"];
	const dbBytes = zipped["db.json"];
	if (!manifestBytes || !dbBytes) {
		throw new Error("Backup archive is missing manifest.json or db.json");
	}

	const decoder = new TextDecoder();
	let manifest: BackupManifest;
	let db: BackupPayload["db"];
	try {
		manifest = JSON.parse(decoder.decode(manifestBytes)) as BackupManifest;
		db = JSON.parse(decoder.decode(dbBytes)) as BackupPayload["db"];
	} catch {
		throw new Error("Backup archive contains invalid JSON metadata");
	}

	if (manifest?.formatVersion !== BACKUP_FORMAT_VERSION) {
		throw new Error("Unsupported backup format version");
	}
	if (!db || typeof db !== "object") {
		throw new Error("Backup archive database payload is invalid");
	}

	const externalAttachmentKeys = new Set<string>(
		options.allowExternalAttachmentBlobs
			? (manifest.attachmentBlobs || []).map(
					(item) =>
						`attachments/${String(item.cipherId || "").trim()}/${String(item.attachmentId || "").trim()}.bin`,
				)
			: [],
	);
	const requiredEntries = getRequiredZipEntries(db).filter(
		(entry) => !externalAttachmentKeys.has(entry),
	);
	for (const entry of requiredEntries) {
		if (!zipped[entry]) {
			throw new Error(`Backup archive is missing required file: ${entry}`);
		}
	}

	return {
		payload: { manifest, db },
		files: zipped,
	};
}

export async function buildBackupArchive(
	db: Kysely<DB>,
	date: Date = new Date(),
	options: BuildBackupArchiveOptions = {},
): Promise<BackupArchiveBundle> {
	const includeAttachments = options.includeAttachments !== false;
	if (includeAttachments && !options.blobStore) {
		throw new Error("Attachment storage is not configured");
	}
	await options.progress?.({
		step: "collect_data",
		fileName: "",
		stageTitle: "txt_backup_archive_progress_collect_title",
		stageDetail: includeAttachments
			? "txt_backup_archive_progress_collect_with_attachments_detail"
			: "txt_backup_archive_progress_collect_detail",
		includeAttachments,
	});
	const encoder = new TextEncoder();

	const [
		configRows,
		userRows,
		domainSettingsRows,
		revisionRows,
		organizationRows,
		orgMemberRows,
		collectionRows,
		collectionMemberRows,
		folderRows,
		cipherRows,
		cipherCollectionRows,
		attachmentRows,
		webauthnRows,
		deviceTrustRows,
		sendsRows,
	] = await Promise.all([
		db.selectFrom("config").selectAll().orderBy("key asc").execute(),
		db.selectFrom("users").selectAll().orderBy("created_at asc").execute(),
		db
			.selectFrom("domain_settings")
			.selectAll()
			.orderBy("user_id asc")
			.execute(),
		db
			.selectFrom("user_revisions")
			.selectAll()
			.orderBy("user_id asc")
			.execute(),
		db
			.selectFrom("organizations")
			.selectAll()
			.orderBy("created_at asc")
			.execute(),
		db
			.selectFrom("org_members")
			.selectAll()
			.orderBy("created_at asc")
			.execute(),
		db
			.selectFrom("collections")
			.selectAll()
			.orderBy("created_at asc")
			.execute(),
		db
			.selectFrom("collection_members")
			.selectAll()
			.orderBy("collection_id asc")
			.execute(),
		db.selectFrom("folders").selectAll().orderBy("created_at asc").execute(),
		db.selectFrom("ciphers").selectAll().orderBy("created_at asc").execute(),
		db
			.selectFrom("cipher_collections")
			.selectAll()
			.orderBy("cipher_id asc")
			.execute(),
		db.selectFrom("attachments").selectAll().orderBy("id asc").execute(),
		db
			.selectFrom("webauthn_credentials")
			.selectAll()
			.orderBy("created_at asc")
			.execute(),
		db
			.selectFrom("device_trust_tokens")
			.selectAll()
			.orderBy("user_id asc")
			.execute(),
		db.selectFrom("sends").selectAll().orderBy("created_at asc").execute(),
	]);

	const exportedConfigRows = sanitizeConfigRowsForExport(
		configRows as unknown as SqlRow[],
	);
	const exportedUserRows = sanitizeUserRowsForExport(
		userRows as unknown as SqlRow[],
	);
	const exportedAttachmentRows = includeAttachments
		? (attachmentRows as unknown as SqlRow[])
		: [];
	const attachmentBlobs: BackupManifestAttachmentBlob[] =
		exportedAttachmentRows.map((row) => {
			const cipherId = String(row.cipher_id || "").trim();
			const attachmentId = String(row.id || "").trim();
			return {
				cipherId,
				attachmentId,
				blobName: `attachments/${cipherId}/${attachmentId}.bin`,
				sizeBytes: Number(row.size || 0) || 0,
			};
		});

	const manifestBase = {
		formatVersion: BACKUP_FORMAT_VERSION,
		exportedAt: date.toISOString(),
		appVersion: EDGEWARDEN_VERSION,
		storageKind: includeAttachments ? (options.blobStore?.kind ?? null) : null,
		tableCounts: {
			config: exportedConfigRows.length,
			users: exportedUserRows.length,
			domain_settings: domainSettingsRows.length,
			user_revisions: revisionRows.length,
			organizations: organizationRows.length,
			org_members: orgMemberRows.length,
			collections: collectionRows.length,
			collection_members: collectionMemberRows.length,
			folders: folderRows.length,
			ciphers: cipherRows.length,
			cipher_collections: cipherCollectionRows.length,
			attachments: exportedAttachmentRows.length,
			webauthn_credentials: webauthnRows.length,
			device_trust_tokens: deviceTrustRows.length,
			sends: sendsRows.length,
		},
		includes: {
			attachments: includeAttachments,
		},
		blobSummary: {
			attachmentFiles: attachmentBlobs.length,
			totalBytes: attachmentBlobs.reduce(
				(sum, item) => sum + item.sizeBytes,
				0,
			),
			largestObjectBytes: attachmentBlobs.reduce(
				(max, item) => Math.max(max, item.sizeBytes),
				0,
			),
		},
		attachmentBlobs: includeAttachments ? attachmentBlobs : [],
	} satisfies BackupManifest;

	const files: Record<string, Uint8Array> = {
		"manifest.json": encoder.encode(
			JSON.stringify(manifestBase, null, BACKUP_JSON_INDENT),
		),
		"db.json": encoder.encode(
			JSON.stringify(
				{
					config: exportedConfigRows,
					users: exportedUserRows,
					domain_settings: domainSettingsRows,
					user_revisions: revisionRows,
					organizations: organizationRows,
					org_members: orgMemberRows,
					collections: collectionRows,
					collection_members: collectionMemberRows,
					folders: folderRows,
					ciphers: cipherRows,
					cipher_collections: cipherCollectionRows,
					attachments: exportedAttachmentRows,
					webauthn_credentials: webauthnRows,
					device_trust_tokens: deviceTrustRows,
					sends: sendsRows,
				},
				null,
				BACKUP_JSON_INDENT,
			),
		),
	};

	if (includeAttachments && options.blobStore) {
		for (const blob of attachmentBlobs) {
			const object = await options.blobStore.get(blob.blobName);
			if (!object?.body) {
				throw new Error(`Backup attachment blob not found: ${blob.blobName}`);
			}
			const bytes = new Uint8Array(
				await new Response(object.body).arrayBuffer(),
			);
			if (bytes.byteLength !== blob.sizeBytes) {
				throw new Error(`Backup attachment size mismatch: ${blob.blobName}`);
			}
			files[blob.blobName] = bytes;
		}
	}

	await options.progress?.({
		step: "package_archive",
		fileName: "",
		stageTitle: "txt_backup_archive_progress_package_title",
		stageDetail: includeAttachments
			? "txt_backup_archive_progress_package_with_attachments_detail"
			: "txt_backup_archive_progress_package_detail",
		includeAttachments,
	});
	const bytes = zipSync(createZipEntries(files));
	const fileHashPrefix = (await sha256Hex(bytes)).slice(
		0,
		BACKUP_FILE_HASH_PREFIX_LENGTH,
	);
	const backupTimeZone = options.timeZone || "UTC";
	const fileName = buildBackupFileNameInTimeZone(
		date,
		fileHashPrefix,
		backupTimeZone,
	);
	await options.progress?.({
		step: "archive_ready",
		fileName,
		stageTitle: "txt_backup_archive_progress_ready_title",
		stageDetail: "txt_backup_archive_progress_ready_detail",
		includeAttachments,
	});

	return {
		bytes,
		fileName,
		manifest: manifestBase,
	};
}
