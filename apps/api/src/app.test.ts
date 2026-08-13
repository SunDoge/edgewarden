import assert from "node:assert/strict";
import { unzipSync, zipSync } from "fflate";
import { afterAll as after, beforeAll as before, describe, test } from "vitest";
import { createDatabase } from "./middleware/db";
import {
	buildBackupArchive,
	parseBackupArchive,
} from "./services/backup/archive";
import { importBackupArchiveBytes } from "./services/backup/import";
import {
	acquireDataOperationLease,
	releaseDataOperationLease,
} from "./services/backup/operation-lease";
import { createBlobStore } from "./services/blob-store";
import { runMaintenance } from "./services/maintenance";
import { registerAccountSecurityScenarios } from "./test-support/account-security-scenarios";
import { registerAdminOrganizationScenarios } from "./test-support/admin-organization-scenarios";
import {
	type ApiTestHarness,
	createApiTestHarness,
} from "./test-support/api-harness";
import { registerAuthReliabilityScenarios } from "./test-support/auth-reliability-scenarios";
import { registerAuthScenarios } from "./test-support/auth-scenarios";
import { registerDatabaseMaintenanceScenarios } from "./test-support/database-maintenance-scenarios";
import { registerInfrastructureScenarios } from "./test-support/infrastructure-scenarios";
import { registerMaintenanceReliabilityScenarios } from "./test-support/maintenance-reliability-scenarios";
import { registerSendScenarios } from "./test-support/send-scenarios";
import { registerVaultScenarios } from "./test-support/vault-scenarios";

const JWT_SECRET = "test-secret-that-is-at-least-thirty-two-characters";
const DATA_ENCRYPTION_SECRET =
	"test-data-encryption-secret-at-least-thirty-two-characters";
const EMAIL = "api-test@example.com";
const MASTER_PASSWORD_HASH = "client-side-master-password-hash";
const MEMBER_EMAIL = "member-api-test@example.com";
const ADMIN_PASSWORD = "test-bootstrap-admin-password";

let harness: ApiTestHarness;
let bindings: CloudflareBindings;
let testDatabase: D1Database;
let accessToken = "";
let refreshToken = "";
let cipherId = "";
let sendId = "";
let sendAccessId = "";
let memberAccessToken = "";
let organizationBackup = new Uint8Array();
let backedUpOrganizationId = "";
let backedUpCollectionId = "";
let r2Values: Map<string, Uint8Array>;

function request(
	path: string,
	init: RequestInit = {},
	executionContext?: ExecutionContext,
) {
	return harness.request(path, init, executionContext);
}

before(async () => {
	harness = await createApiTestHarness({
		adminPassword: ADMIN_PASSWORD,
		jwtSecret: JWT_SECRET,
		dataEncryptionSecret: DATA_ENCRYPTION_SECRET,
	});
	bindings = harness.bindings;
	testDatabase = harness.database;
	r2Values = harness.r2Values;
});

after(async () => {
	await harness.dispose();
});

describe("Edgewarden API", () => {
	registerInfrastructureScenarios({ getBindings: () => bindings, request });
	registerAuthScenarios({
		get bindings() {
			return bindings;
		},
		get database() {
			return testDatabase;
		},
		get accessToken() {
			return accessToken;
		},
		set accessToken(value) {
			accessToken = value;
		},
		get refreshToken() {
			return refreshToken;
		},
		set refreshToken(value) {
			refreshToken = value;
		},
		get memberAccessToken() {
			return memberAccessToken;
		},
		set memberAccessToken(value) {
			memberAccessToken = value;
		},
		request,
		email: EMAIL,
		memberEmail: MEMBER_EMAIL,
		masterPasswordHash: MASTER_PASSWORD_HASH,
		adminPassword: ADMIN_PASSWORD,
	});
	registerAuthReliabilityScenarios({
		get database() {
			return testDatabase;
		},
		email: EMAIL,
	});
	registerVaultScenarios({
		get database() {
			return testDatabase;
		},
		get accessToken() {
			return accessToken;
		},
		get memberAccessToken() {
			return memberAccessToken;
		},
		get r2Values() {
			return r2Values;
		},
		set memberAccessToken(value) {
			memberAccessToken = value;
		},
		get cipherId() {
			return cipherId;
		},
		set cipherId(value) {
			cipherId = value;
		},
		request,
		email: EMAIL,
		masterPasswordHash: MASTER_PASSWORD_HASH,
	});
	registerSendScenarios({
		get database() {
			return testDatabase;
		},
		get accessToken() {
			return accessToken;
		},
		get memberAccessToken() {
			return memberAccessToken;
		},
		get cipherId() {
			return cipherId;
		},
		get sendId() {
			return sendId;
		},
		set sendId(value) {
			sendId = value;
		},
		get sendAccessId() {
			return sendAccessId;
		},
		set sendAccessId(value) {
			sendAccessId = value;
		},
		request,
		masterPasswordHash: MASTER_PASSWORD_HASH,
	});
	registerAdminOrganizationScenarios({
		get bindings() {
			return bindings;
		},
		get database() {
			return testDatabase;
		},
		get accessToken() {
			return accessToken;
		},
		get memberAccessToken() {
			return memberAccessToken;
		},
		set memberAccessToken(value) {
			memberAccessToken = value;
		},
		get cipherId() {
			return cipherId;
		},
		get sendId() {
			return sendId;
		},
		get organizationBackup() {
			return organizationBackup;
		},
		set organizationBackup(value) {
			organizationBackup = value;
		},
		get backedUpOrganizationId() {
			return backedUpOrganizationId;
		},
		set backedUpOrganizationId(value) {
			backedUpOrganizationId = value;
		},
		get backedUpCollectionId() {
			return backedUpCollectionId;
		},
		set backedUpCollectionId(value) {
			backedUpCollectionId = value;
		},
		request,
		email: EMAIL,
		memberEmail: MEMBER_EMAIL,
		masterPasswordHash: MASTER_PASSWORD_HASH,
	});
	registerDatabaseMaintenanceScenarios({
		get database() {
			return testDatabase;
		},
		get bindings() {
			return bindings;
		},
		get r2Values() {
			return r2Values;
		},
		email: EMAIL,
	});
	registerMaintenanceReliabilityScenarios({
		get database() {
			return testDatabase;
		},
		get bindings() {
			return bindings;
		},
		get r2Values() {
			return r2Values;
		},
		email: EMAIL,
	});
	registerAccountSecurityScenarios({
		get database() {
			return testDatabase;
		},
		get bindings() {
			return bindings;
		},
		get memberAccessToken() {
			return memberAccessToken;
		},
		set memberAccessToken(value) {
			memberAccessToken = value;
		},
		request,
		email: EMAIL,
		memberEmail: MEMBER_EMAIL,
		masterPasswordHash: MASTER_PASSWORD_HASH,
		dataEncryptionSecret: DATA_ENCRYPTION_SECRET,
	});

	test("restores attachment bytes atomically and cleans failed staging", async () => {
		const owner = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(owner?.id);
		const attachmentId = crypto.randomUUID();
		const originalStorageKey = `attachments/${cipherId}/${attachmentId}.bin`;
		const attachmentBytes = new Uint8Array([0, 7, 23, 128, 254, 255]);
		const fileSendId = crypto.randomUUID();
		const sendFileId = crypto.randomUUID();
		const originalSendStorageKey = `sends/${fileSendId}/${sendFileId}`;
		const sendFileBytes = new Uint8Array([255, 128, 23, 7, 0]);
		const auditId = crypto.randomUUID();
		const postBackupAuditId = crypto.randomUUID();
		const postBackupOrdinaryAuditId = crypto.randomUUID();
		const postBackupTargetId = crypto.randomUUID();
		const postBackupActorId = crypto.randomUUID();
		const deviceTrustToken = `backup-must-not-export-${crypto.randomUUID()}`;
		const timestamp = Math.floor(Date.now() / 1000);
		await testDatabase
			.prepare(
				"INSERT INTO attachments (id,cipher_id,file_name,size,size_name,key,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)",
			)
			.bind(
				attachmentId,
				cipherId,
				"encrypted-restore-name",
				attachmentBytes.byteLength,
				`${attachmentBytes.byteLength} Bytes`,
				"encrypted-restore-key",
				originalStorageKey,
				timestamp,
			)
			.run();
		r2Values.set(originalStorageKey, attachmentBytes);
		await testDatabase
			.prepare(
				"INSERT INTO sends (id,user_id,type,name,data,key,created_at,updated_at,deletion_date,storage_key) VALUES (?,?,?,?,?,?,?,?,?,?)",
			)
			.bind(
				fileSendId,
				owner.id,
				1,
				"encrypted-file-send-name",
				JSON.stringify({
					id: sendFileId,
					size: sendFileBytes.byteLength,
					sizeName: `${sendFileBytes.byteLength} Bytes`,
					fileName: "encrypted-file-name",
				}),
				"encrypted-send-key",
				timestamp,
				timestamp,
				timestamp + 86400,
				originalSendStorageKey,
			)
			.run();
		r2Values.set(originalSendStorageKey, sendFileBytes);
		await testDatabase
			.prepare(
				"INSERT INTO audit_logs (id,actor_user_id,action,category,level,target_type,target_id,metadata,is_tombstone,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
			)
			.bind(
				auditId,
				owner.id,
				"send.delete",
				"system",
				"info",
				"send",
				fileSendId,
				JSON.stringify({ status: "test" }),
				1,
				timestamp,
			)
			.run();
		await testDatabase
			.prepare(
				"INSERT INTO device_trust_tokens (token,user_id,device_identifier,expires_at) VALUES (?,?,?,?)",
			)
			.bind(deviceTrustToken, owner.id, "backup-test-device", timestamp + 3600)
			.run();
		const blobStore = createBlobStore(bindings);
		assert.ok(blobStore);
		let backupCheckpoints = 0;
		const archive = await buildBackupArchive(testDatabase, new Date(), {
			includeAttachments: true,
			blobStore,
			checkpoint: async () => {
				backupCheckpoints += 1;
			},
		});
		assert.ok(backupCheckpoints >= 3);
		const metadataOnlyArchive = await buildBackupArchive(
			testDatabase,
			new Date(),
			{
				includeAttachments: false,
			},
		);
		assert.equal(
			(
				parseBackupArchive(metadataOnlyArchive.bytes).payload.db.sends || []
			).some((row) => Number(row.type) === 1),
			false,
		);
		const parsedArchive = parseBackupArchive(archive.bytes);
		assert.equal(parsedArchive.payload.manifest.formatVersion, 3);
		assert.ok(
			(parsedArchive.payload.db.ciphers || []).every(
				(row) => !("mutation_token" in row) && !("purge_token" in row),
			),
		);
		assert.ok(
			(parsedArchive.payload.db.folders || []).every(
				(row) => !("mutation_token" in row),
			),
		);
		assert.ok(
			(parsedArchive.payload.db.collections || []).every(
				(row) => !("mutation_token" in row),
			),
		);
		assert.ok(
			(parsedArchive.payload.db.org_members || []).every(
				(row) => !("mutation_token" in row),
			),
		);
		assert.ok(
			(parsedArchive.payload.db.webauthn_credentials || []).every(
				(row) => !("mutation_token" in row),
			),
		);
		assert.ok(
			(parsedArchive.payload.db.organizations || []).every(
				(row) => !("deletion_token" in row),
			),
		);
		assert.ok((parsedArchive.payload.manifest.blobSummary.sendFiles || 0) >= 1);
		assert.ok(
			(parsedArchive.payload.db.audit_logs || []).some(
				(row) => row.id === auditId && row.actor_user_id === owner.id,
			),
		);
		assert.deepEqual(parsedArchive.payload.db.device_trust_tokens, []);
		assert.deepEqual(
			parsedArchive.files[`sends/${fileSendId}/${sendFileId}`],
			sendFileBytes,
		);
		const incompleteArchiveFiles = unzipSync(archive.bytes);
		delete incompleteArchiveFiles[`sends/${fileSendId}/${sendFileId}`];
		assert.throws(
			() => parseBackupArchive(zipSync(incompleteArchiveFiles)),
			new RegExp(`missing required file: sends/${fileSendId}/${sendFileId}`),
		);
		const legacyArchiveFiles = { ...incompleteArchiveFiles };
		const legacyManifest = JSON.parse(
			new TextDecoder().decode(legacyArchiveFiles["manifest.json"]),
		) as { formatVersion: number };
		legacyManifest.formatVersion = 1;
		legacyArchiveFiles["manifest.json"] = Uint8Array.from(
			new TextEncoder().encode(JSON.stringify(legacyManifest)),
		);
		assert.equal(
			parseBackupArchive(zipSync(legacyArchiveFiles)).payload.manifest
				.formatVersion,
			1,
		);
		await testDatabase
			.prepare(
				"INSERT INTO users (id,email,master_password_hash,key,kdf_type,kdf_iterations,security_stamp,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
			)
			.bind(
				postBackupActorId,
				`post-backup-${postBackupActorId}@example.com`,
				"post-backup-master-password-hash",
				"post-backup-encrypted-key",
				0,
				600_000,
				crypto.randomUUID(),
				timestamp + 1,
				timestamp + 1,
			)
			.run();
		await testDatabase
			.prepare(
				"INSERT INTO audit_logs (id,actor_user_id,action,category,level,target_type,target_id,metadata,is_tombstone,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
			)
			.bind(
				postBackupAuditId,
				postBackupActorId,
				"cipher.delete.permanent",
				"vault",
				"warning",
				"cipher",
				postBackupTargetId,
				JSON.stringify({ status: "deleted-after-backup" }),
				1,
				timestamp + 1,
			)
			.run();
		await testDatabase
			.prepare(
				"INSERT INTO audit_logs (id,actor_user_id,action,category,level,target_type,target_id,metadata,is_tombstone,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
			)
			.bind(
				postBackupOrdinaryAuditId,
				owner.id,
				"vault.read",
				"vault",
				"info",
				"cipher",
				postBackupTargetId,
				"{}",
				0,
				timestamp + 1,
			)
			.run();
		assert.equal(
			(parsedArchive.payload.db.audit_logs || []).some(
				(row) => row.id === postBackupAuditId,
			),
			false,
		);

		const originalObjectKeys = new Set(r2Values.keys());
		await testDatabase
			.prepare(`
				CREATE TRIGGER test_fail_restore_swap
				BEFORE DELETE ON users
				BEGIN
					SELECT RAISE(ABORT, 'forced restore swap failure');
				END
			`)
			.run();
		try {
			await assert.rejects(
				importBackupArchiveBytes(
					archive.bytes,
					testDatabase,
					blobStore,
					DATA_ENCRYPTION_SECRET,
					owner.id,
					true,
				),
				/forced restore swap failure/,
			);
		} finally {
			await testDatabase
				.prepare("DROP TRIGGER IF EXISTS test_fail_restore_swap")
				.run();
		}
		assert.deepEqual(new Set(r2Values.keys()), originalObjectKeys);
		assert.equal(
			await testDatabase
				.prepare("SELECT storage_key FROM attachments WHERE id = ?")
				.bind(attachmentId)
				.first<{ storage_key: string }>()
				.then((row) => row?.storage_key),
			originalStorageKey,
		);
		assert.deepEqual(r2Values.get(originalStorageKey), attachmentBytes);
		assert.equal(
			await testDatabase
				.prepare("SELECT storage_key FROM sends WHERE id = ?")
				.bind(fileSendId)
				.first<{ storage_key: string }>()
				.then((row) => row?.storage_key),
			originalSendStorageKey,
		);
		assert.deepEqual(r2Values.get(originalSendStorageKey), sendFileBytes);
		assert.ok(
			await testDatabase
				.prepare("SELECT 1 FROM device_trust_tokens WHERE token = ?")
				.bind(deviceTrustToken)
				.first(),
		);
		assert.ok(
			await testDatabase
				.prepare("SELECT 1 FROM audit_logs WHERE id = ?")
				.bind(postBackupOrdinaryAuditId)
				.first(),
		);
		assert.ok(
			await testDatabase
				.prepare(
					"SELECT 1 FROM audit_logs WHERE id = ? AND actor_user_id = ? AND target_id = ? AND is_tombstone = 1",
				)
				.bind(postBackupAuditId, postBackupActorId, postBackupTargetId)
				.first(),
		);
		await testDatabase
			.prepare(`
				CREATE TRIGGER test_fail_restore_audit
				BEFORE INSERT ON audit_logs
				WHEN NEW.action = 'backup.restored'
				BEGIN
					SELECT RAISE(ABORT, 'forced restore audit failure');
				END
			`)
			.run();
		try {
			await assert.rejects(
				importBackupArchiveBytes(
					archive.bytes,
					testDatabase,
					blobStore,
					DATA_ENCRYPTION_SECRET,
					owner.id,
					true,
				),
				/forced restore audit failure/,
			);
		} finally {
			await testDatabase
				.prepare("DROP TRIGGER IF EXISTS test_fail_restore_audit")
				.run();
		}
		assert.deepEqual(new Set(r2Values.keys()), originalObjectKeys);
		assert.ok(
			await testDatabase
				.prepare("SELECT 1 FROM audit_logs WHERE id = ?")
				.bind(postBackupOrdinaryAuditId)
				.first(),
		);
		assert.ok(
			await testDatabase
				.prepare(
					"SELECT 1 FROM audit_logs WHERE id = ? AND actor_user_id = ? AND target_id = ? AND is_tombstone = 1",
				)
				.bind(postBackupAuditId, postBackupActorId, postBackupTargetId)
				.first(),
		);
		const r2 = bindings.ATTACHMENTS_R2 as R2Bucket;
		const originalDelete = r2.delete.bind(r2);
		r2.delete = async (key: string | string[]) => {
			const keys = Array.isArray(key) ? key : [key];
			if (
				keys.includes(originalStorageKey) ||
				keys.includes(originalSendStorageKey)
			) {
				throw new Error("simulated restore cleanup outage");
			}
			await originalDelete(key);
		};
		let restored: Awaited<ReturnType<typeof importBackupArchiveBytes>>;
		const restoreLease = await acquireDataOperationLease(
			testDatabase,
			"backup.restore_test",
		);
		assert.ok(restoreLease);
		try {
			restored = await importBackupArchiveBytes(
				archive.bytes,
				testDatabase,
				blobStore,
				DATA_ENCRYPTION_SECRET,
				owner.id,
				true,
			);
		} finally {
			r2.delete = originalDelete;
		}
		assert.ok(
			await testDatabase
				.prepare(
					"SELECT 1 FROM config WHERE key = 'backup.runner.lock.v1' AND json_extract(value, '$.token') = ?",
				)
				.bind(restoreLease.token)
				.first(),
		);
		await releaseDataOperationLease(testDatabase, restoreLease);
		assert.equal(restored.result.imported.attachments, 1);
		assert.equal(restored.result.imported.sendFiles, 1);
		assert.ok(restored.result.imported.auditLogs >= 1);
		assert.equal(restored.result.imported.deviceTrustTokens, 0);
		const restoredStorageKey = await testDatabase
			.prepare("SELECT storage_key FROM attachments WHERE id = ?")
			.bind(attachmentId)
			.first<{ storage_key: string }>()
			.then((row) => row?.storage_key);
		assert.ok(restoredStorageKey);
		assert.notEqual(restoredStorageKey, originalStorageKey);
		assert.deepEqual(r2Values.get(restoredStorageKey), attachmentBytes);
		const restoredSendStorageKey = await testDatabase
			.prepare("SELECT storage_key FROM sends WHERE id = ?")
			.bind(fileSendId)
			.first<{ storage_key: string }>()
			.then((row) => row?.storage_key);
		assert.ok(restoredSendStorageKey);
		assert.notEqual(restoredSendStorageKey, originalSendStorageKey);
		assert.deepEqual(r2Values.get(restoredSendStorageKey), sendFileBytes);
		assert.equal(r2Values.has(originalStorageKey), true);
		assert.equal(r2Values.has(originalSendStorageKey), true);
		assert.ok(
			await testDatabase
				.prepare(
					"SELECT 1 FROM blob_gc_queue WHERE object_key = ? AND attempts >= 1",
				)
				.bind(originalStorageKey)
				.first(),
		);
		assert.ok(
			await testDatabase
				.prepare(
					"SELECT 1 FROM blob_gc_queue WHERE object_key = ? AND attempts >= 1",
				)
				.bind(originalSendStorageKey)
				.first(),
		);
		const maintenanceDatabase = await createDatabase(testDatabase);
		try {
			const cleanup = await runMaintenance(
				maintenanceDatabase.db,
				bindings,
				Math.floor(Date.now() / 1000) + 300,
			);
			assert.ok(cleanup.blobGc.deleted >= 1);
		} finally {
			await maintenanceDatabase.db.destroy();
		}
		assert.equal(r2Values.has(originalStorageKey), false);
		assert.equal(r2Values.has(originalSendStorageKey), false);
		assert.ok(
			await testDatabase
				.prepare(
					"SELECT 1 FROM audit_logs WHERE id = ? AND actor_user_id = ? AND target_id = ? AND is_tombstone = 1",
				)
				.bind(auditId, owner.id, fileSendId)
				.first(),
		);
		assert.ok(
			await testDatabase
				.prepare(
					"SELECT 1 FROM audit_logs WHERE id = ? AND actor_user_id IS NULL AND target_id = ? AND is_tombstone = 1",
				)
				.bind(postBackupAuditId, postBackupTargetId)
				.first(),
		);
		assert.ok(
			await testDatabase
				.prepare(`
					SELECT 1 FROM audit_logs
					WHERE action = 'backup.restored'
					  AND actor_user_id = ?
					  AND target_id = 'edgewarden_backup.zip'
					  AND json_extract(metadata, '$.status') = 'success'
				`)
				.bind(owner.id)
				.first(),
		);
		assert.equal(
			await testDatabase
				.prepare("SELECT 1 FROM audit_logs WHERE id = ?")
				.bind(postBackupOrdinaryAuditId)
				.first(),
			null,
		);
		assert.equal(
			await testDatabase
				.prepare("SELECT 1 FROM device_trust_tokens WHERE token = ?")
				.bind(deviceTrustToken)
				.first(),
			null,
		);
		assert.equal(
			(
				await request("/api/accounts/profile", {
					headers: { authorization: `Bearer ${accessToken}` },
				})
			).status,
			401,
		);
	});

	test("restores a complete organization backup without API credentials", async () => {
		assert.ok(organizationBackup.byteLength > 0);
		const owner = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(owner?.id);
		const restored = await importBackupArchiveBytes(
			organizationBackup,
			testDatabase,
			null,
			DATA_ENCRYPTION_SECRET,
			owner.id,
			true,
		);
		assert.ok(restored.result.imported.organizations > 0);
		assert.ok(restored.result.imported.organizationMembers > 0);
		assert.ok(restored.result.imported.cipherCollections > 0);
		assert.ok(
			await testDatabase
				.prepare("SELECT id FROM organizations WHERE id = ?")
				.bind(backedUpOrganizationId)
				.first(),
		);
		assert.ok(
			await testDatabase
				.prepare("SELECT id FROM collections WHERE id = ?")
				.bind(backedUpCollectionId)
				.first(),
		);
		assert.deepEqual(
			await testDatabase
				.prepare(
					"SELECT api_key_hash, api_key_encrypted FROM users WHERE id = ?",
				)
				.bind(owner.id)
				.first<{
					api_key_hash: string | null;
					api_key_encrypted: string | null;
				}>()
				.then((row) => [
					row?.api_key_hash ?? null,
					row?.api_key_encrypted ?? null,
				]),
			[null, null],
		);
		assert.equal(
			(
				await request("/api/accounts/profile", {
					headers: { authorization: `Bearer ${accessToken}` },
				})
			).status,
			401,
		);
	});
});
