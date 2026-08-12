import type { BlobStore } from "../blob-store";
import { type BackupPayload, parseBackupArchive } from "./archive";
import {
	importPreparedBackupRows,
	prepareImportPayloadForTarget,
} from "./import-prepare";
import {
	ATTACHMENT_RESTORE_FAILED_REASON,
	type AttachmentRestoreResult,
	type BackupImportSkipSummary,
	BLOB_STORAGE_UNAVAILABLE_SKIP_REASON,
} from "./import-types";
import {
	type BackupTableName,
	collectCurrentBlobKeys,
	createShadowTables,
	ensureImportTargetIsFresh,
	resetRestoreArtifacts,
	type SqlRow,
	shadowTableName,
	swapShadowTablesIntoPlace,
	validateShadowTableCounts,
} from "./restore-database";

export interface BackupImportResultBody {
	object: "instance-backup-import";
	imported: {
		config: number;
		users: number;
		domainSettings: number;
		userRevisions: number;
		organizations: number;
		organizationMembers: number;
		collections: number;
		collectionMembers: number;
		folders: number;
		ciphers: number;
		cipherCollections: number;
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

function backupTableCounts(
	db: BackupPayload["db"],
	attachmentCount = (db.attachments || []).length,
): Partial<Record<BackupTableName, number>> {
	return {
		config: (db.config || []).length,
		users: (db.users || []).length,
		domain_settings: (db.domain_settings || []).length,
		user_revisions: (db.user_revisions || []).length,
		organizations: (db.organizations || []).length,
		org_members: (db.org_members || []).length,
		collections: (db.collections || []).length,
		collection_members: (db.collection_members || []).length,
		device_trust_tokens: (db.device_trust_tokens || []).length,
		webauthn_credentials: (db.webauthn_credentials || []).length,
		folders: (db.folders || []).length,
		ciphers: (db.ciphers || []).length,
		cipher_collections: (db.cipher_collections || []).length,
		attachments: attachmentCount,
		sends: (db.sends || []).length,
	};
}

function buildImportExecutionResult(
	db: BackupPayload["db"],
	actorUserId: string,
	restoredAttachmentCount: number,
	skipped: BackupImportSkipSummary,
): BackupImportExecutionResult {
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
				organizations: (db.organizations || []).length,
				organizationMembers: (db.org_members || []).length,
				collections: (db.collections || []).length,
				collectionMembers: (db.collection_members || []).length,
				folders: (db.folders || []).length,
				ciphers: (db.ciphers || []).length,
				cipherCollections: (db.cipher_collections || []).length,
				attachments: restoredAttachmentCount,
				webauthnCredentials: (db.webauthn_credentials || []).length,
				deviceTrustTokens: (db.device_trust_tokens || []).length,
				sends: (db.sends || []).length,
				attachmentFiles: restoredAttachmentCount,
			},
			skipped,
		},
	};
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

export async function importBackupArchiveBytes(
	archiveBytes: Uint8Array,
	dbBinding: D1Database,
	blobStore: BlobStore | null,
	dataEncryptionSecret: string,
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
			dataEncryptionSecret,
		);
		await validateShadowTableCounts(dbBinding, backupTableCounts(db));

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
		await validateShadowTableCounts(
			dbBinding,
			backupTableCounts(db, restored.restoredAttachments.length),
		);
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
		return buildImportExecutionResult(
			db,
			actorUserId,
			restored.restoredAttachments.length,
			restored.skipped,
		);
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
	dataEncryptionSecret: string,
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
			dataEncryptionSecret,
		);
		await validateShadowTableCounts(dbBinding, backupTableCounts(db));

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
		await validateShadowTableCounts(
			dbBinding,
			backupTableCounts(db, restoredAttachments.length),
		);

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

		return buildImportExecutionResult(
			db,
			actorUserId,
			restoredAttachments.length,
			{
				reason: skippedItems.length ? ATTACHMENT_RESTORE_FAILED_REASON : null,
				attachments: skippedItems.length,
				items: skippedItems,
			},
		);
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
