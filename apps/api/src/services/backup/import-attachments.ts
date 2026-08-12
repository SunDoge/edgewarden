import type { BlobStore } from "../blob-store";
import type { BackupPayload } from "./archive";
import {
	ATTACHMENT_RESTORE_FAILED_REASON,
	type AttachmentRestoreResult,
	type BackupImportSkipSummary,
	BLOB_STORAGE_UNAVAILABLE_SKIP_REASON,
} from "./import-types";
import { type SqlRow, shadowTableName } from "./restore-database";

export function attachmentRowKey(row: SqlRow): string {
	const attachmentId = String(row.id || "").trim();
	const cipherId = String(row.cipher_id || "").trim();
	return `${cipherId}/${attachmentId}`;
}

export async function restoreBlobFiles(
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
		const sourceKey = `attachments/${cipherId}/${attachmentId}.bin`;
		const targetKey = String(row.storage_key || "").trim() || sourceKey;
		const bytes = files[sourceKey];
		if (!bytes) {
			skippedItems.push({
				kind: "attachment",
				path: sourceKey,
				sizeBytes: Number(row.size || 0) || 0,
			});
			continue;
		}
		try {
			await blobStore.put(targetKey, bytes, {
				size: bytes.byteLength,
				contentType: "application/octet-stream",
			});
			restoredAttachments.push(row);
		} catch {
			skippedItems.push({
				kind: "attachment",
				path: sourceKey,
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

export async function removeAttachmentRows(
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

export async function cleanupOrphanedBlobFiles(
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
