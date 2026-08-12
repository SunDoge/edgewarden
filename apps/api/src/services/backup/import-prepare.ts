import {
	createRestoredAttachmentObjectKey,
	type BlobStore,
} from "../blob-store";
import type { BackupPayload } from "./archive";
import {
	BACKUP_SETTINGS_CONFIG_KEY,
	normalizeImportedBackupSettingsValue,
} from "./config";
import {
	type BackupImportSkipSummary,
	BLOB_STORAGE_UNAVAILABLE_SKIP_REASON,
	KV_BLOB_SKIP_REASON,
	type PreparedBackupImportPayload,
} from "./import-types";
import type { SqlRow } from "./restore-database";
import { importBackupRows } from "./restore-rows";

function cloneRows(rows: SqlRow[]): SqlRow[] {
	return rows.map((row) => ({ ...row }));
}

function upsertConfigRow(rows: SqlRow[], key: string, value: string): SqlRow[] {
	let replaced = false;
	const nextRows = rows.map((row) => {
		if (String(row.key || "").trim() !== key) return { ...row };
		replaced = true;
		return { ...row, key, value };
	});
	if (!replaced) nextRows.push({ key, value });
	return nextRows;
}

async function prepareImportedConfigRows(
	dataEncryptionSecret: string,
	configRows: SqlRow[],
	userRows: SqlRow[],
): Promise<SqlRow[]> {
	let nextConfigRows = cloneRows(configRows || []);
	const rawBackupSettings = nextConfigRows.find(
		(row) => String(row.key || "").trim() === BACKUP_SETTINGS_CONFIG_KEY,
	);
	const normalizedBackupSettings = await normalizeImportedBackupSettingsValue(
		typeof rawBackupSettings?.value === "string"
			? rawBackupSettings.value
			: null,
		dataEncryptionSecret,
		userRows.map((row) => ({
			id: String(row.id || "").trim(),
			public_key: typeof row.public_key === "string" ? row.public_key : null,
			role: String(row.role || "").trim(),
			status: String(row.status || "").trim(),
		})),
		"UTC",
	);
	if (normalizedBackupSettings !== null) {
		nextConfigRows = upsertConfigRow(
			nextConfigRows,
			BACKUP_SETTINGS_CONFIG_KEY,
			normalizedBackupSettings,
		);
	}
	return upsertConfigRow(nextConfigRows, "registered", "true");
}

export async function importPreparedBackupRows(
	db: D1Database,
	payload: BackupPayload["db"],
	dataEncryptionSecret: string,
): Promise<BackupPayload["db"]> {
	const preparedDb: BackupPayload["db"] = {
		config: await prepareImportedConfigRows(
			dataEncryptionSecret,
			payload.config || [],
			payload.users || [],
		),
		users: cloneRows(payload.users || []).map((row) => ({
			...row,
			verify_devices: row.verify_devices ?? 1,
			security_stamp: crypto.randomUUID(),
		})),
		domain_settings: cloneRows(payload.domain_settings || []),
		user_revisions: cloneRows(payload.user_revisions || []),
		organizations: cloneRows(payload.organizations || []),
		org_members: cloneRows(payload.org_members || []),
		collections: cloneRows(payload.collections || []),
		collection_members: cloneRows(payload.collection_members || []),
		device_trust_tokens: cloneRows(payload.device_trust_tokens || []),
		webauthn_credentials: cloneRows(payload.webauthn_credentials || []),
		folders: cloneRows(payload.folders || []),
		ciphers: cloneRows(payload.ciphers || []).map((row) => ({
			...row,
			archived_at: row.archived_at ?? null,
		})),
		cipher_collections: cloneRows(payload.cipher_collections || []),
		attachments: cloneRows(payload.attachments || []).map((row) => {
			const cipherId = String(row.cipher_id || "").trim();
			const attachmentId = String(row.id || "").trim();
			return {
				...row,
				storage_key:
					cipherId && attachmentId
						? createRestoredAttachmentObjectKey(cipherId, attachmentId)
						: null,
			};
		}),
		sends: cloneRows(payload.sends || []),
	};
	await importBackupRows(db, preparedDb, true);
	return preparedDb;
}

export function prepareImportPayloadForTarget(
	blobStore: BlobStore | null,
	payload: BackupPayload,
	files: Record<string, Uint8Array>,
): PreparedBackupImportPayload {
	if (!blobStore) {
		const skippedItems = (payload.db.attachments || []).map((row) => {
			const cipherId = String(row.cipher_id || "").trim();
			const attachmentId = String(row.id || "").trim();
			return {
				kind: "attachment" as const,
				path: `attachments/${cipherId}/${attachmentId}.bin`,
				sizeBytes: Number(row.size || 0) || 0,
			};
		});
		return {
			payload: { ...payload, db: { ...payload.db, attachments: [] } },
			skipped: {
				reason: skippedItems.length
					? BLOB_STORAGE_UNAVAILABLE_SKIP_REASON
					: null,
				attachments: skippedItems.length,
				items: skippedItems,
			},
		};
	}

	const oversizedAttachmentPaths = new Set<string>();
	const skippedItems: BackupImportSkipSummary["items"] = [];
	for (const entry of Object.keys(files)) {
		if (!entry.endsWith(".bin")) continue;
		const sizeBytes = files[entry].byteLength;
		if (
			blobStore.maxObjectBytes === null ||
			sizeBytes <= blobStore.maxObjectBytes
		)
			continue;
		if (entry.startsWith("attachments/")) {
			oversizedAttachmentPaths.add(entry);
			skippedItems.push({ kind: "attachment", path: entry, sizeBytes });
		}
	}
	const attachments = (payload.db.attachments || []).filter((row) => {
		const cipherId = String(row.cipher_id || "").trim();
		const attachmentId = String(row.id || "").trim();
		if (!cipherId || !attachmentId) return false;
		return !oversizedAttachmentPaths.has(
			`attachments/${cipherId}/${attachmentId}.bin`,
		);
	});
	return {
		payload: { ...payload, db: { ...payload.db, attachments } },
		skipped: {
			reason: skippedItems.length ? KV_BLOB_SKIP_REASON : null,
			attachments: skippedItems.length,
			items: skippedItems,
		},
	};
}
