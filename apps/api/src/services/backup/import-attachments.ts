import type { BlobStore } from "../blob-store";
import { parseStoredSendFileMetadata } from "../sends/file-metadata";
import type { BackupPayload } from "./archive";
import {
	ATTACHMENT_RESTORE_FAILED_REASON,
	type BlobRestoreResult,
	type BackupImportSkipSummary,
	BLOB_STORAGE_UNAVAILABLE_SKIP_REASON,
} from "./import-types";
import { type SqlRow, shadowTableName } from "./restore-database";

export function attachmentRowKey(row: SqlRow): string {
	const attachmentId = String(row.id || "").trim();
	const cipherId = String(row.cipher_id || "").trim();
	return `${cipherId}/${attachmentId}`;
}

export function sendRowKey(row: SqlRow): string {
	return String(row.id || "").trim();
}

export async function restoreBlobFiles(
	blobStore: BlobStore | null,
	db: BackupPayload["db"],
	files: Record<string, Uint8Array>,
	onStored?: (storageKey: string) => void,
): Promise<BlobRestoreResult> {
	const restoredAttachments: SqlRow[] = [];
	const restoredFileSends: SqlRow[] = [];
	const skippedItems: BackupImportSkipSummary["items"] = [];
	const fileSendRows = (db.sends || []).filter((row) => Number(row.type) === 1);

	if (!blobStore) {
		return {
			importedAttachments: 0,
			importedSendFiles: 0,
			restoredAttachments: [],
			restoredFileSends: [],
			skipped: {
				reason: BLOB_STORAGE_UNAVAILABLE_SKIP_REASON,
				attachments: (db.attachments || []).length,
				sendFiles: fileSendRows.length,
				items: [
					...(db.attachments || []).map(
						(row) =>
							({
								kind: "attachment",
								path: `attachments/${row.cipher_id}/${row.id}.bin`,
								sizeBytes: Number(row.size || 0),
							}) as const,
					),
					...fileSendRows.map((row) => {
						const metadata = parseStoredSendFileMetadata(row.data);
						return {
							kind: "sendFile" as const,
							path: `sends/${row.id}/${metadata?.fileId || "invalid"}`,
							sizeBytes: metadata?.sizeBytes || 0,
						};
					}),
				],
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
		const expectedSize = Number(row.size || 0) || 0;
		if (!bytes || bytes.byteLength !== expectedSize) {
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
			onStored?.(targetKey);
			restoredAttachments.push(row);
		} catch (error) {
			throw new Error(`Failed to restore backup blob: ${sourceKey}`, {
				cause: error,
			});
		}
	}

	for (const row of fileSendRows) {
		const sendId = sendRowKey(row);
		const metadata = parseStoredSendFileMetadata(row.data);
		if (!sendId || !metadata) {
			skippedItems.push({
				kind: "sendFile",
				path: `sends/${sendId || "invalid"}/invalid`,
				sizeBytes: 0,
			});
			continue;
		}
		const sourceKey = `sends/${sendId}/${metadata.fileId}`;
		const targetKey = String(row.storage_key || "").trim();
		const bytes = files[sourceKey];
		if (!targetKey || !bytes || bytes.byteLength !== metadata.sizeBytes) {
			skippedItems.push({
				kind: "sendFile",
				path: sourceKey,
				sizeBytes: metadata.sizeBytes,
			});
			continue;
		}
		try {
			await blobStore.put(targetKey, bytes, {
				size: bytes.byteLength,
				contentType: "application/octet-stream",
			});
			onStored?.(targetKey);
			restoredFileSends.push(row);
		} catch (error) {
			throw new Error(`Failed to restore backup blob: ${sourceKey}`, {
				cause: error,
			});
		}
	}

	return {
		importedAttachments: restoredAttachments.length,
		importedSendFiles: restoredFileSends.length,
		restoredAttachments,
		restoredFileSends,
		skipped: {
			reason: skippedItems.length ? ATTACHMENT_RESTORE_FAILED_REASON : null,
			sendFiles: skippedItems.filter((item) => item.kind === "sendFile").length,
			attachments: skippedItems.filter((item) => item.kind === "attachment")
				.length,
			items: skippedItems,
		},
	};
}

export async function removeSendRows(
	db: D1Database,
	sendRows: SqlRow[],
	useShadowTable = false,
): Promise<void> {
	if (!sendRows.length) return;
	const tableName = useShadowTable ? shadowTableName("sends") : "sends";
	const statements = sendRows
		.map((row) => sendRowKey(row))
		.filter(Boolean)
		.map((sendId) =>
			db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).bind(sendId),
		);
	if (statements.length) await db.batch(statements);
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
