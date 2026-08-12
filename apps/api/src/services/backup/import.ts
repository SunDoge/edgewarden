import type { BlobStore } from "../blob-store";
import { invalidateAllAuthCaches } from "../auth";
import { drainBlobGcQueue, enqueueBlobGcKeys } from "../blob-gc";
import { createDatabase } from "../../middleware/db";
import { parseBackupArchive } from "./archive";
import { readActiveDataOperationLeaseValue } from "./operation-lease";
import {
	importPreparedBackupRows,
	prepareImportPayloadForTarget,
} from "./import-prepare";
import { mergeBackupImportSkips } from "./import-types";
import {
	backupTableCounts,
	buildImportExecutionResult,
	ensureBackupCompatibilityFields,
	type BackupImportExecutionResult,
	type BackupRestoreProgressReporter,
} from "./import-contract";
import {
	attachmentRowKey,
	removeAttachmentRows,
	removeSendRows,
	restoreBlobFiles,
	sendRowKey,
} from "./import-attachments";
import {
	collectCurrentBlobKeys,
	createShadowTables,
	ensureImportTargetIsFresh,
	resetRestoreArtifacts,
	swapShadowTablesIntoPlace,
	validateShadowTableCounts,
} from "./restore-database";

async function drainRestoreBlobGc(
	dbBinding: D1Database,
	blobStore: BlobStore | null,
): Promise<void> {
	if (!blobStore) return;
	const { db } = await createDatabase(dbBinding);
	try {
		await drainBlobGcQueue(db, blobStore);
	} finally {
		await db.destroy();
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
	ensureBackupCompatibilityFields(parsed.payload);

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
	const stagedBlobKeys = new Set<string>();
	const activeOperationLeaseValue =
		await readActiveDataOperationLeaseValue(dbBinding);
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
			activeOperationLeaseValue,
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
		const restored = await restoreBlobFiles(
			blobStore,
			db,
			parsed.files,
			(key) => stagedBlobKeys.add(key),
		);
		const restoredAttachmentKeys = new Set(
			(restored.restoredAttachments || []).map(attachmentRowKey),
		);
		const failedRestoreRows = (db.attachments || []).filter(
			(row) => !restoredAttachmentKeys.has(attachmentRowKey(row)),
		);
		await removeAttachmentRows(dbBinding, failedRestoreRows, true).catch(
			() => undefined,
		);
		const restoredSendKeys = new Set(
			restored.restoredFileSends.map(sendRowKey),
		);
		const failedFileSendRows = (db.sends || []).filter(
			(row) => Number(row.type) === 1 && !restoredSendKeys.has(sendRowKey(row)),
		);
		await removeSendRows(dbBinding, failedFileSendRows, true).catch(
			() => undefined,
		);
		await validateShadowTableCounts(
			dbBinding,
			backupTableCounts(
				db,
				restored.restoredAttachments.length,
				(db.sends || []).length - failedFileSendRows.length,
			),
		);
		await progress?.({
			source: "local",
			step: "local_finalize",
			fileName,
			stageTitle: "txt_backup_restore_progress_local_finalize_title",
			stageDetail: "txt_backup_restore_progress_local_finalize_detail",
			replaceExisting,
		});
		await swapShadowTablesIntoPlace(dbBinding, previousBlobKeys);
		invalidateAllAuthCaches();
		await resetRestoreArtifacts(dbBinding).catch(() => undefined);
		await drainRestoreBlobGc(dbBinding, blobStore).catch(() => undefined);

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
			(db.sends || []).length - failedFileSendRows.length,
			restored.restoredFileSends.length,
			mergeBackupImportSkips(prepared.skipped, restored.skipped),
		);
	} catch (error) {
		await resetRestoreArtifacts(dbBinding).catch(() => undefined);
		await enqueueBlobGcKeys(dbBinding, stagedBlobKeys).catch(() => undefined);
		await drainRestoreBlobGc(dbBinding, blobStore).catch(() => undefined);
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
	const parsed = parseBackupArchive(archiveBytes, {
		allowExternalAttachmentBlobs: true,
	});
	ensureBackupCompatibilityFields(parsed.payload);

	for (const row of parsed.payload.db.attachments || []) {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		const path = `attachments/${cipherId}/${attachmentId}.bin`;
		if (!parsed.files[path]) {
			const bytes = await source.loadAttachment(path).catch(() => null);
			if (bytes) parsed.files[path] = bytes;
		}
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
	const stagedBlobKeys = new Set<string>();
	const activeOperationLeaseValue =
		await readActiveDataOperationLeaseValue(dbBinding);

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
			prepared.payload.db,
			dataEncryptionSecret,
			activeOperationLeaseValue,
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

		const restored = await restoreBlobFiles(
			blobStore,
			db,
			parsed.files,
			(key) => stagedBlobKeys.add(key),
		);

		const restoredAttachmentKeys = new Set(
			restored.restoredAttachments.map(attachmentRowKey),
		);
		const failedRestoreRows = (db.attachments || []).filter(
			(row) => !restoredAttachmentKeys.has(attachmentRowKey(row)),
		);
		await removeAttachmentRows(dbBinding, failedRestoreRows, true).catch(
			() => undefined,
		);
		const restoredSendKeys = new Set(
			restored.restoredFileSends.map(sendRowKey),
		);
		const failedFileSendRows = (db.sends || []).filter(
			(row) => Number(row.type) === 1 && !restoredSendKeys.has(sendRowKey(row)),
		);
		await removeSendRows(dbBinding, failedFileSendRows, true).catch(
			() => undefined,
		);
		await validateShadowTableCounts(
			dbBinding,
			backupTableCounts(
				db,
				restored.restoredAttachments.length,
				(db.sends || []).length - failedFileSendRows.length,
			),
		);

		await progress?.({
			source: "remote",
			step: "remote_finalize",
			fileName,
			stageTitle: "txt_backup_restore_progress_remote_finalize_title",
			stageDetail: "txt_backup_restore_progress_remote_finalize_detail",
			replaceExisting,
		});
		await swapShadowTablesIntoPlace(dbBinding, previousBlobKeys);
		invalidateAllAuthCaches();
		await resetRestoreArtifacts(dbBinding).catch(() => undefined);
		await drainRestoreBlobGc(dbBinding, blobStore).catch(() => undefined);

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
			restored.restoredAttachments.length,
			(db.sends || []).length - failedFileSendRows.length,
			restored.restoredFileSends.length,
			mergeBackupImportSkips(prepared.skipped, restored.skipped),
		);
	} catch (error) {
		await resetRestoreArtifacts(dbBinding).catch(() => undefined);
		await enqueueBlobGcKeys(dbBinding, stagedBlobKeys).catch(() => undefined);
		await drainRestoreBlobGc(dbBinding, blobStore).catch(() => undefined);
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
