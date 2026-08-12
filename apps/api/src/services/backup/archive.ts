import { EDGEWARDEN_VERSION } from "@edgewarden/shared";
import { unzipSync, zipSync } from "fflate";
import {
	type BlobStore,
	getStoredAttachmentObjectKey,
	getStoredSendFileObjectKey,
} from "../blob-store";
import {
	buildBackupFileNameInTimeZone,
	getBackupArchiveChecksumPrefix,
	verifyBackupArchiveFileNameChecksum,
} from "./archive-integrity";
import { BACKUP_SETTINGS_CONFIG_KEY } from "./config";
import { DATA_OPERATION_LEASE_CONFIG_KEY } from "./operation-lease";
import { exportPortableBackupSettingsEnvelope } from "./settings-crypto";
import { readBackupDatabaseSnapshot } from "./snapshot";

export type { BackupFileIntegrityCheckResult } from "./archive-integrity";
export {
	extractBackupFileChecksumPrefix,
	inspectBackupArchiveFileNameChecksum,
	verifyBackupArchiveFileNameChecksum,
} from "./archive-integrity";

type SqlRow = Record<string, string | number | null>;

const BACKUP_FORMAT_VERSION = 3;
const BACKUP_TEXT_COMPRESSION_LEVEL = 0;
const BACKUP_JSON_INDENT = 2;
const MAX_BACKUP_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_ARCHIVE_ENTRY_COUNT = 10000;
const MAX_BACKUP_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_DB_JSON_BYTES = 32 * 1024 * 1024;

export interface BackupManifest {
	formatVersion: 1 | 2 | 3;
	exportedAt: string;
	appVersion: string;
	storageKind: "kv" | "r2" | null;
	tableCounts: Record<string, number>;
	includes: {
		attachments: boolean;
		fileSends?: boolean;
	};
	blobSummary: {
		attachmentFiles: number;
		sendFiles?: number;
		totalBytes: number;
		largestObjectBytes: number;
	};
	attachmentBlobs?: BackupManifestAttachmentBlob[];
	sendBlobs?: BackupManifestSendBlob[];
}

export interface BackupManifestAttachmentBlob {
	cipherId: string;
	attachmentId: string;
	blobName: string;
	sizeBytes: number;
}

export interface BackupManifestSendBlob {
	sendId: string;
	fileId: string;
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
		audit_logs?: SqlRow[];
		sends?: SqlRow[];
	};
}

const BACKUP_DB_TABLES = [
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
] as const satisfies readonly (keyof BackupPayload["db"])[];

function validateBackupDatabasePayload(
	manifest: BackupManifest,
	db: BackupPayload["db"],
): void {
	if (!db || typeof db !== "object" || Array.isArray(db)) {
		throw new Error("Backup archive database payload is invalid");
	}
	if (
		!manifest.tableCounts ||
		typeof manifest.tableCounts !== "object" ||
		Array.isArray(manifest.tableCounts)
	) {
		throw new Error("Backup archive table counts are invalid");
	}
	for (const table of BACKUP_DB_TABLES) {
		const rows = db[table];
		const declared = manifest.tableCounts[table];
		if (rows === undefined && declared === undefined) continue;
		if (!Array.isArray(rows)) {
			throw new Error(`Backup archive table is not an array: ${table}`);
		}
		if (
			rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
		) {
			throw new Error(`Backup archive contains an invalid row in: ${table}`);
		}
		if (!Number.isSafeInteger(declared) || Number(declared) < 0) {
			throw new Error(`Backup archive table count is invalid: ${table}`);
		}
		if (rows.length !== declared) {
			throw new Error(
				`Backup archive table count mismatch for ${table}: expected ${declared}, received ${rows.length}`,
			);
		}
	}
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

export interface BuildBackupArchiveOptions {
	includeAttachments?: boolean;
	blobStore?: BlobStore | null;
	progress?: BackupArchiveBuildProgressReporter;
	checkpoint?: () => Promise<void>;
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
		if (!key || key === DATA_OPERATION_LEASE_CONFIG_KEY) continue;

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

function validateArchiveSize(bytes: Uint8Array): void {
	if (bytes.byteLength > MAX_BACKUP_ARCHIVE_BYTES) {
		throw new Error(
			`Backup archive is too large. The current restore limit is ${Math.floor(MAX_BACKUP_ARCHIVE_BYTES / (1024 * 1024))} MiB`,
		);
	}
}

function parseSendFileMetadata(row: SqlRow): {
	fileId: string;
	sizeBytes: number;
} | null {
	if (Number(row.type) !== 1) return null;
	try {
		const data = JSON.parse(String(row.data || "")) as {
			id?: unknown;
			size?: unknown;
		};
		const fileId = typeof data.id === "string" ? data.id.trim() : "";
		const sizeBytes = Number(data.size);
		return fileId && Number.isSafeInteger(sizeBytes) && sizeBytes >= 0
			? { fileId, sizeBytes }
			: null;
	} catch {
		return null;
	}
}

function getRequiredZipEntries(
	db: BackupPayload["db"],
	formatVersion: 1 | 2 | 3,
): string[] {
	const entries: string[] = [];
	for (const row of db.attachments) {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		if (!cipherId || !attachmentId) continue;
		entries.push(`attachments/${cipherId}/${attachmentId}.bin`);
	}
	if (formatVersion >= 2) {
		for (const row of db.sends || []) {
			if (Number(row.type) !== 1) continue;
			const sendId = String(row.id || "").trim();
			const file = parseSendFileMetadata(row);
			if (!sendId || !file) {
				throw new Error("Backup archive contains invalid file Send metadata");
			}
			entries.push(`sends/${sendId}/${file.fileId}`);
		}
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

	if (
		manifest?.formatVersion !== 1 &&
		manifest?.formatVersion !== 2 &&
		manifest?.formatVersion !== 3
	) {
		throw new Error("Unsupported backup format version");
	}
	validateBackupDatabasePayload(manifest, db);

	const externalAttachmentKeys = new Set<string>(
		options.allowExternalAttachmentBlobs
			? (manifest.attachmentBlobs || []).map(
					(item) =>
						`attachments/${String(item.cipherId || "").trim()}/${String(item.attachmentId || "").trim()}.bin`,
				)
			: [],
	);
	const requiredEntries = getRequiredZipEntries(
		db,
		manifest.formatVersion,
	).filter((entry) => !externalAttachmentKeys.has(entry));
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
	db: D1Database,
	date: Date = new Date(),
	options: BuildBackupArchiveOptions = {},
): Promise<BackupArchiveBundle> {
	const includeAttachments = options.includeAttachments !== false;
	if (includeAttachments && !options.blobStore) {
		throw new Error("File storage is not configured");
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
	const snapshotTimestamp = Math.floor(date.getTime() / 1000);

	const {
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
		auditRows,
		sendsRows,
	} = await readBackupDatabaseSnapshot(db, snapshotTimestamp);
	await options.checkpoint?.();

	const exportedConfigRows = sanitizeConfigRowsForExport(
		configRows as unknown as SqlRow[],
	);
	const exportedUserRows = sanitizeUserRowsForExport(
		userRows as unknown as SqlRow[],
	);
	const exportedUserIds = new Set(
		exportedUserRows.map((row) => String(row.id || "").trim()),
	);
	const exportedAuditRows = auditRows.map((row) => ({
		...row,
		actor_user_id:
			row.actor_user_id && exportedUserIds.has(String(row.actor_user_id))
				? String(row.actor_user_id)
				: null,
	})) as unknown as SqlRow[];
	const sourceAttachmentRows = includeAttachments ? attachmentRows : [];
	const sourceSendRows = sendsRows.filter(
		(row) => Number(row.type) !== 1 || includeAttachments,
	);
	const exportedAttachmentRows = sourceAttachmentRows.map(
		({ storage_key: _storageKey, deleted_at: _deletedAt, ...row }) =>
			row as SqlRow,
	);
	const attachmentBlobs = sourceAttachmentRows.map((row) => {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		return {
			cipherId,
			attachmentId,
			blobName: `attachments/${cipherId}/${attachmentId}.bin`,
			storageKey: getStoredAttachmentObjectKey({
				id: attachmentId,
				cipher_id: cipherId,
				storage_key:
					typeof row.storage_key === "string" ? row.storage_key : null,
			}),
			sizeBytes: Number(row.size || 0) || 0,
		};
	});
	const manifestAttachmentBlobs: BackupManifestAttachmentBlob[] =
		attachmentBlobs.map(({ storageKey: _storageKey, ...blob }) => blob);
	const sendBlobs = sourceSendRows.flatMap((row) => {
		if (Number(row.type) !== 1) return [];
		const sendId = String(row.id || "").trim();
		const file = parseSendFileMetadata(row as unknown as SqlRow);
		if (!sendId || !file) {
			throw new Error(
				`Backup file Send metadata is invalid: ${sendId || "unknown"}`,
			);
		}
		return [
			{
				sendId,
				fileId: file.fileId,
				blobName: `sends/${sendId}/${file.fileId}`,
				storageKey: getStoredSendFileObjectKey(
					{
						id: sendId,
						storage_key:
							typeof row.storage_key === "string" ? row.storage_key : null,
					},
					file.fileId,
				),
				sizeBytes: file.sizeBytes,
			},
		];
	});
	const exportedSendRows = sourceSendRows.map(
		({ storage_key: _storageKey, ...row }) => row as SqlRow,
	);
	const manifestSendBlobs: BackupManifestSendBlob[] = sendBlobs.map(
		({ storageKey: _storageKey, ...blob }) => blob,
	);
	const allBlobs = [...attachmentBlobs, ...sendBlobs];

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
			device_trust_tokens: 0,
			audit_logs: exportedAuditRows.length,
			sends: exportedSendRows.length,
		},
		includes: {
			attachments: includeAttachments,
			fileSends: includeAttachments,
		},
		blobSummary: {
			attachmentFiles: attachmentBlobs.length,
			sendFiles: sendBlobs.length,
			totalBytes: allBlobs.reduce((sum, item) => sum + item.sizeBytes, 0),
			largestObjectBytes: allBlobs.reduce(
				(max, item) => Math.max(max, item.sizeBytes),
				0,
			),
		},
		attachmentBlobs: includeAttachments ? manifestAttachmentBlobs : [],
		sendBlobs: includeAttachments ? manifestSendBlobs : [],
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
					device_trust_tokens: [],
					audit_logs: exportedAuditRows,
					sends: exportedSendRows,
				},
				null,
				BACKUP_JSON_INDENT,
			),
		),
	};

	if (includeAttachments && options.blobStore) {
		for (const blob of allBlobs) {
			await options.checkpoint?.();
			const object = await options.blobStore.get(blob.storageKey);
			if (!object?.body) {
				throw new Error(`Backup blob not found: ${blob.blobName}`);
			}
			const bytes = new Uint8Array(
				await new Response(object.body).arrayBuffer(),
			);
			if (bytes.byteLength !== blob.sizeBytes) {
				throw new Error(`Backup blob size mismatch: ${blob.blobName}`);
			}
			files[blob.blobName] = bytes;
		}
	}

	await options.checkpoint?.();
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
	validateArchiveSize(bytes);
	const fileHashPrefix = await getBackupArchiveChecksumPrefix(bytes);
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

export async function assertBackupArchiveIntegrity(
	bytes: Uint8Array,
	fileName: string,
	expectedByteLength?: number,
): Promise<BackupPayload> {
	if (
		expectedByteLength !== undefined &&
		bytes.byteLength !== expectedByteLength
	) {
		throw new Error("Backup archive size changed after upload");
	}
	if (!(await verifyBackupArchiveFileNameChecksum(bytes, fileName))) {
		throw new Error("Backup archive checksum does not match its filename");
	}
	return parseBackupArchive(bytes).payload;
}
