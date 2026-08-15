export type BackupSnapshotRow = Record<string, string | number | null>;

export interface BackupDatabaseSnapshot {
	configRows: BackupSnapshotRow[];
	userRows: BackupSnapshotRow[];
	domainSettingsRows: BackupSnapshotRow[];
	revisionRows: BackupSnapshotRow[];
	organizationRows: BackupSnapshotRow[];
	orgMemberRows: BackupSnapshotRow[];
	collectionRows: BackupSnapshotRow[];
	collectionMemberRows: BackupSnapshotRow[];
	folderRows: BackupSnapshotRow[];
	cipherRows: BackupSnapshotRow[];
	cipherUserSettingRows: BackupSnapshotRow[];
	cipherCollectionRows: BackupSnapshotRow[];
	attachmentRows: BackupSnapshotRow[];
	webauthnRows: BackupSnapshotRow[];
	auditRows: BackupSnapshotRow[];
	sendsRows: BackupSnapshotRow[];
}

function rows(result: D1Result | undefined): BackupSnapshotRow[] {
	return (result?.results || []).map((row) => ({
		...(row as BackupSnapshotRow),
	}));
}

export async function readBackupDatabaseSnapshot(
	db: D1Database,
	_snapshotTimestamp: number,
): Promise<BackupDatabaseSnapshot> {
	// A server backup is an audit/disaster-recovery snapshot, not a client sync
	// response. Include logically deleted entities and their relationships so a
	// restore cannot silently erase retained history.
	const results = await db.batch([
		db.prepare("SELECT * FROM config ORDER BY key ASC"),
		db.prepare("SELECT * FROM users ORDER BY created_at ASC"),
		db.prepare("SELECT * FROM domain_settings ORDER BY user_id ASC"),
		db.prepare("SELECT * FROM user_revisions ORDER BY user_id ASC"),
		db.prepare("SELECT * FROM organizations ORDER BY created_at ASC"),
		db.prepare("SELECT * FROM org_members ORDER BY created_at ASC"),
		db.prepare("SELECT * FROM collections ORDER BY created_at ASC"),
		db.prepare("SELECT * FROM collection_members ORDER BY collection_id ASC"),
		db.prepare("SELECT * FROM folders ORDER BY created_at ASC"),
		db.prepare("SELECT * FROM ciphers ORDER BY created_at ASC"),
		db.prepare(
			"SELECT * FROM cipher_user_settings ORDER BY cipher_id ASC, user_id ASC",
		),
		db.prepare("SELECT * FROM cipher_collections ORDER BY cipher_id ASC"),
		db.prepare("SELECT * FROM attachments ORDER BY id ASC"),
		db.prepare("SELECT * FROM webauthn_credentials ORDER BY created_at ASC"),
		db.prepare("SELECT * FROM audit_logs ORDER BY created_at ASC, id ASC"),
		db.prepare("SELECT * FROM sends ORDER BY created_at ASC"),
	]);

	return {
		configRows: rows(results[0]),
		userRows: rows(results[1]),
		domainSettingsRows: rows(results[2]),
		revisionRows: rows(results[3]),
		organizationRows: rows(results[4]),
		orgMemberRows: rows(results[5]),
		collectionRows: rows(results[6]),
		collectionMemberRows: rows(results[7]),
		folderRows: rows(results[8]),
		cipherRows: rows(results[9]),
		cipherUserSettingRows: rows(results[10]),
		cipherCollectionRows: rows(results[11]),
		attachmentRows: rows(results[12]),
		webauthnRows: rows(results[13]),
		auditRows: rows(results[14]),
		sendsRows: rows(results[15]),
	};
}
