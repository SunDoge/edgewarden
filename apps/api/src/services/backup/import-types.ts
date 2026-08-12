import type { BackupPayload } from "./archive";
import type { SqlRow } from "./restore-database";

export const KV_BLOB_SKIP_REASON = "Cloudflare KV object size limit (25 MB)";
export const BLOB_STORAGE_UNAVAILABLE_SKIP_REASON =
	"Attachment storage is not configured";
export const ATTACHMENT_RESTORE_FAILED_REASON =
	"Some attachments could not be restored and were skipped";

export interface BackupImportSkipSummary {
	reason: string | null;
	attachments: number;
	items: Array<{
		kind: "attachment";
		path: string;
		sizeBytes: number;
	}>;
}

export interface PreparedBackupImportPayload {
	payload: BackupPayload;
	skipped: BackupImportSkipSummary;
}

export interface AttachmentRestoreResult {
	imported: number;
	restoredAttachments: SqlRow[];
	skipped: BackupImportSkipSummary;
}
