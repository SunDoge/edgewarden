import type { BackupPayload } from "./archive";
import type { BackupImportSkipSummary } from "./import-types";
import type { BackupTableName } from "./restore-database";

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
		auditLogs: number;
		sends: number;
		attachmentFiles: number;
		sendFiles: number;
	};
	skipped: BackupImportSkipSummary;
}

export interface BackupImportExecutionResult {
	result: BackupImportResultBody;
	auditActorUserId: string | null;
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

export function ensureBackupCompatibilityFields(payload: BackupPayload) {
	payload.db.sends ??= [];
	payload.db.device_trust_tokens ??= [];
	payload.db.audit_logs ??= [];
	payload.db.webauthn_credentials ??= [];
}

export function backupTableCounts(
	db: BackupPayload["db"],
	attachmentCount = (db.attachments || []).length,
	sendCount = (db.sends || []).length,
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
		audit_logs: (db.audit_logs || []).length,
		webauthn_credentials: (db.webauthn_credentials || []).length,
		folders: (db.folders || []).length,
		ciphers: (db.ciphers || []).length,
		cipher_collections: (db.cipher_collections || []).length,
		attachments: attachmentCount,
		sends: sendCount,
	};
}

export function buildImportExecutionResult(
	db: BackupPayload["db"],
	actorUserId: string,
	restoredAttachmentCount: number,
	restoredSendCount: number,
	restoredSendFileCount: number,
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
				auditLogs: (db.audit_logs || []).length,
				sends: restoredSendCount,
				attachmentFiles: restoredAttachmentCount,
				sendFiles: restoredSendFileCount,
			},
			skipped,
		},
	};
}
