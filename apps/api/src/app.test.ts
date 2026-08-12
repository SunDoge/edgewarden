import assert from "node:assert/strict";
import { afterAll as after, beforeAll as before, describe, test } from "vitest";
import { importBackupArchiveBytes } from "./services/backup/import";
import { registerAccountSecurityScenarios } from "./test-support/account-security-scenarios";
import { registerAdminOrganizationScenarios } from "./test-support/admin-organization-scenarios";
import {
	type ApiTestHarness,
	createApiTestHarness,
} from "./test-support/api-harness";
import { registerAuthScenarios } from "./test-support/auth-scenarios";
import { registerDatabaseMaintenanceScenarios } from "./test-support/database-maintenance-scenarios";
import { registerInfrastructureScenarios } from "./test-support/infrastructure-scenarios";
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
