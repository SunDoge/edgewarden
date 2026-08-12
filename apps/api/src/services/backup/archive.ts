import { unzipSync, zipSync } from "fflate";
import { type Kysely, sql } from "kysely";
import type { DB } from "../../types/db";
import {
	getStoredAttachmentObjectKey,
	getStoredSendFileObjectKey,
	type BlobStore,
} from "../blob-store";
import { BACKUP_SETTINGS_CONFIG_KEY } from "./config";
import { EDGEWARDEN_VERSION } from "@edgewarden/shared";
import { exportPortableBackupSettingsEnvelope } from "./settings-crypto";
import {
	buildBackupFileNameInTimeZone,
	getBackupArchiveChecksumPrefix,
} from "./archive-integrity";

export {
	extractBackupFileChecksumPrefix,
	inspectBackupArchiveFileNameChecksum,
	verifyBackupArchiveFileNameChecksum,
} from "./archive-integrity";
export type { BackupFileIntegrityCheckResult } from "./archive-integrity";

type SqlRow = Record<string, string | number | null>;

const BACKUP_FORMAT_VERSION = 2;
const BACKUP_RUNNER_LOCK_CONFIG_KEY = "backup.runner.lock.v1";
const BACKUP_TEXT_COMPRESSION_LEVEL = 0;
const BACKUP_JSON_INDENT = 2;
const MAX_BACKUP_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_ARCHIVE_ENTRY_COUNT = 10000;
const MAX_BACKUP_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_DB_JSON_BYTES = 32 * 1024 * 1024;

export interface BackupManifest {
	formatVersion: 1 | 2;
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
	formatVersion: 1 | 2,
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

	if (manifest?.formatVersion !== 1 && manifest?.formatVersion !== 2) {
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
	db: Kysely<DB>,
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

	// Kysely-D1 exposes one connection for this archive. Keep reads ordered so
	// the adapter never overlaps session requests while building a snapshot.
	const configRows = await db
		.selectFrom("config")
		.selectAll()
		.orderBy("key asc")
		.execute();
	const userRows = await db
		.selectFrom("users")
		.selectAll()
		.where("deletion_requested_at", "is", null)
		.orderBy("created_at asc")
		.execute();
	const domainSettingsRows = await db
		.selectFrom("domain_settings")
		.selectAll()
		.where(
			sql<boolean>`user_id in (select id from users where deletion_requested_at is null)`,
		)
		.orderBy("user_id asc")
		.execute();
	const revisionRows = await db
		.selectFrom("user_revisions")
		.selectAll()
		.where(
			sql<boolean>`user_id in (select id from users where deletion_requested_at is null)`,
		)
		.orderBy("user_id asc")
		.execute();
	const organizationRows = await db
		.selectFrom("organizations")
		.selectAll()
		.where("deletion_requested_at", "is", null)
		.where(
			sql<boolean>`owner_id in (select id from users where deletion_requested_at is null)`,
		)
		.orderBy("created_at asc")
		.execute();
	const orgMemberRows = await db
		.selectFrom("org_members")
		.selectAll()
		.where(
			sql<boolean>`org_id in (
				select id from organizations where deletion_requested_at is null
			)`,
		)
		.where(
			sql<boolean>`user_id is null or user_id in (
				select id from users where deletion_requested_at is null
			)`,
		)
		.orderBy("created_at asc")
		.execute();
	const collectionRows = await db
		.selectFrom("collections")
		.selectAll()
		.where(
			sql<boolean>`org_id in (
				select id from organizations where deletion_requested_at is null
			)`,
		)
		.orderBy("created_at asc")
		.execute();
	const collectionMemberRows = await db
		.selectFrom("collection_members")
		.selectAll()
		.where(
			sql<boolean>`org_member_id in (
				select member.id from org_members member
				inner join organizations org on org.id = member.org_id
				where org.deletion_requested_at is null
					and (member.user_id is null or member.user_id in (
						select id from users where deletion_requested_at is null
					))
			)`,
		)
		.orderBy("collection_id asc")
		.execute();
	const folderRows = await db
		.selectFrom("folders")
		.selectAll()
		.where(
			sql<boolean>`user_id in (select id from users where deletion_requested_at is null)`,
		)
		.orderBy("created_at asc")
		.execute();
	const cipherRows = await db
		.selectFrom("ciphers")
		.selectAll()
		.where((expression) =>
			expression.or([
				expression("purge_after", "is", null),
				expression("purge_after", ">", snapshotTimestamp),
			]),
		)
		.where(
			sql<boolean>`(
			user_id in (select id from users where deletion_requested_at is null)
			or org_id in (select id from organizations where deletion_requested_at is null)
		)`,
		)
		.orderBy("created_at asc")
		.execute();
	const cipherCollectionRows = await db
		.selectFrom("cipher_collections")
		.selectAll()
		.where(
			sql<boolean>`cipher_id in (
				select id from ciphers
				where (purge_after is null or purge_after > ${snapshotTimestamp})
				and (
					user_id in (select id from users where deletion_requested_at is null)
					or org_id in (select id from organizations where deletion_requested_at is null)
				)
			)`,
		)
		.orderBy("cipher_id asc")
		.execute();
	const attachmentRows = await db
		.selectFrom("attachments")
		.selectAll()
		.where("deleted_at", "is", null)
		.where(
			sql<boolean>`cipher_id in (
				select id from ciphers
				where (purge_after is null or purge_after > ${snapshotTimestamp})
				and (
					user_id in (select id from users where deletion_requested_at is null)
					or org_id in (select id from organizations where deletion_requested_at is null)
				)
			)`,
		)
		.orderBy("id asc")
		.execute();
	const webauthnRows = await db
		.selectFrom("webauthn_credentials")
		.selectAll()
		.where(
			sql<boolean>`user_id in (select id from users where deletion_requested_at is null)`,
		)
		.orderBy("created_at asc")
		.execute();
	const deviceTrustRows = await db
		.selectFrom("device_trust_tokens")
		.selectAll()
		.where(
			sql<boolean>`user_id in (select id from users where deletion_requested_at is null)`,
		)
		.orderBy("user_id asc")
		.execute();
	const sendsRows = await db
		.selectFrom("sends")
		.selectAll()
		.where("deletion_date", ">", snapshotTimestamp)
		.where(
			sql<boolean>`(
			user_id in (select id from users where deletion_requested_at is null)
			or org_id in (select id from organizations where deletion_requested_at is null)
		)`,
		)
		.orderBy("created_at asc")
		.execute();

	const exportedConfigRows = sanitizeConfigRowsForExport(
		configRows as unknown as SqlRow[],
	);
	const exportedUserRows = sanitizeUserRowsForExport(
		userRows as unknown as SqlRow[],
	);
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
			storageKey: getStoredAttachmentObjectKey(row),
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
				storageKey: getStoredSendFileObjectKey(row, file.fileId),
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
			device_trust_tokens: deviceTrustRows.length,
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
					device_trust_tokens: deviceTrustRows,
					sends: exportedSendRows,
				},
				null,
				BACKUP_JSON_INDENT,
			),
		),
	};

	if (includeAttachments && options.blobStore) {
		for (const blob of allBlobs) {
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
