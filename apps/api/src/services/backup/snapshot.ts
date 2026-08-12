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
	snapshotTimestamp: number,
): Promise<BackupDatabaseSnapshot> {
	const activeUsers =
		"SELECT id FROM users WHERE deletion_requested_at IS NULL";
	const activeOrganizations =
		"SELECT id FROM organizations WHERE deletion_requested_at IS NULL";
	const activeCiphers = `
		SELECT id FROM ciphers
		WHERE (purge_after IS NULL OR purge_after > ?)
		  AND (
			user_id IN (${activeUsers})
			OR org_id IN (${activeOrganizations})
		  )
	`;
	const results = await db.batch([
		db.prepare("SELECT * FROM config ORDER BY key ASC"),
		db.prepare(
			"SELECT * FROM users WHERE deletion_requested_at IS NULL ORDER BY created_at ASC",
		),
		db.prepare(
			`SELECT * FROM domain_settings WHERE user_id IN (${activeUsers}) ORDER BY user_id ASC`,
		),
		db.prepare(
			`SELECT * FROM user_revisions WHERE user_id IN (${activeUsers}) ORDER BY user_id ASC`,
		),
		db.prepare(`
			SELECT * FROM organizations
			WHERE deletion_requested_at IS NULL
			  AND owner_id IN (${activeUsers})
			ORDER BY created_at ASC
		`),
		db.prepare(`
			SELECT * FROM org_members
			WHERE org_id IN (${activeOrganizations})
			  AND (user_id IS NULL OR user_id IN (${activeUsers}))
			ORDER BY created_at ASC
		`),
		db.prepare(
			`SELECT * FROM collections WHERE org_id IN (${activeOrganizations}) ORDER BY created_at ASC`,
		),
		db.prepare(`
			SELECT * FROM collection_members
			WHERE org_member_id IN (
				SELECT member.id FROM org_members member
				INNER JOIN organizations org ON org.id = member.org_id
				WHERE org.deletion_requested_at IS NULL
				  AND (member.user_id IS NULL OR member.user_id IN (${activeUsers}))
			)
			ORDER BY collection_id ASC
		`),
		db.prepare(
			`SELECT * FROM folders WHERE user_id IN (${activeUsers}) ORDER BY created_at ASC`,
		),
		db
			.prepare(`
				SELECT * FROM ciphers
				WHERE (purge_after IS NULL OR purge_after > ?)
				  AND (
					user_id IN (${activeUsers})
					OR org_id IN (${activeOrganizations})
				  )
				ORDER BY created_at ASC
			`)
			.bind(snapshotTimestamp),
		db
			.prepare(
				`SELECT * FROM cipher_collections WHERE cipher_id IN (${activeCiphers}) ORDER BY cipher_id ASC`,
			)
			.bind(snapshotTimestamp),
		db
			.prepare(`
				SELECT * FROM attachments
				WHERE deleted_at IS NULL
				  AND cipher_id IN (${activeCiphers})
				ORDER BY id ASC
			`)
			.bind(snapshotTimestamp),
		db.prepare(
			`SELECT * FROM webauthn_credentials WHERE user_id IN (${activeUsers}) ORDER BY created_at ASC`,
		),
		db.prepare("SELECT * FROM audit_logs ORDER BY created_at ASC, id ASC"),
		db
			.prepare(`
				SELECT * FROM sends
				WHERE deletion_date > ?
				  AND (
					user_id IN (${activeUsers})
					OR org_id IN (${activeOrganizations})
				  )
				ORDER BY created_at ASC
			`)
			.bind(snapshotTimestamp),
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
		cipherCollectionRows: rows(results[10]),
		attachmentRows: rows(results[11]),
		webauthnRows: rows(results[12]),
		auditRows: rows(results[13]),
		sendsRows: rows(results[14]),
	};
}
