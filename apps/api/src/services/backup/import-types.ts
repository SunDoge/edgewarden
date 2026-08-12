import type { BackupPayload } from "./archive";
import type { SqlRow } from "./restore-database";

export const KV_BLOB_SKIP_REASON = "Cloudflare KV object size limit (25 MB)";
export const BLOB_STORAGE_UNAVAILABLE_SKIP_REASON =
	"File storage is not configured";
export const ATTACHMENT_RESTORE_FAILED_REASON =
	"Some attachments or file Sends could not be restored and were skipped";

export interface BackupImportSkipSummary {
	reason: string | null;
	attachments: number;
	sendFiles: number;
	items: Array<{
		kind: "attachment" | "sendFile";
		path: string;
		sizeBytes: number;
	}>;
}

export interface PreparedBackupImportPayload {
	payload: BackupPayload;
	skipped: BackupImportSkipSummary;
}

export interface BlobRestoreResult {
	importedAttachments: number;
	importedSendFiles: number;
	restoredAttachments: SqlRow[];
	restoredFileSends: SqlRow[];
	skipped: BackupImportSkipSummary;
}

export function mergeBackupImportSkips(
	...summaries: BackupImportSkipSummary[]
): BackupImportSkipSummary {
	const items = summaries.flatMap((summary) => summary.items);
	return {
		reason: items.length
			? summaries.find((summary) => summary.reason)?.reason ||
				ATTACHMENT_RESTORE_FAILED_REASON
			: null,
		attachments: items.filter((item) => item.kind === "attachment").length,
		sendFiles: items.filter((item) => item.kind === "sendFile").length,
		items,
	};
}
