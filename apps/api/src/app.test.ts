import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { afterAll as after, beforeAll as before, describe, test } from "vitest";
import { createDatabase } from "./middleware/db";
import { invalidateUserCache } from "./services/auth";
import { importBackupArchiveBytes } from "./services/backup/import";
import {
	encryptCredential,
	hashCredential,
} from "./services/credential-protection";
import { executeBatch } from "./services/db/batch";
import { runMaintenance } from "./services/maintenance";
import { loadYubicoCredentials } from "./services/yubico-config";
import {
	type ApiTestHarness,
	createApiTestHarness,
} from "./test-support/api-harness";
import { registerAuthScenarios } from "./test-support/auth-scenarios";
import { registerInfrastructureScenarios } from "./test-support/infrastructure-scenarios";

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

	test("creates a folder and cipher through authenticated batch-backed handlers", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const profileAlias = await request("/api/accounts/profile", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ name: "API Test", masterPasswordHint: null }),
		});
		assert.equal(profileAlias.status, 200, await profileAlias.clone().text());
		const folderResponse = await request("/api/folders", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ name: "encrypted-folder-name" }),
		});
		assert.equal(
			folderResponse.status,
			200,
			await folderResponse.clone().text(),
		);
		const folder = await folderResponse.json<{ id: string }>();

		const cipherResponse = await request("/api/ciphers", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({
				type: 1,
				name: "encrypted-cipher-name",
				folderId: folder.id,
				favorite: true,
				login: { username: "encrypted-user", password: "encrypted-pass" },
				fields: [{ name: "encrypted-field", value: "encrypted-value" }],
				futureClientField: { encrypted: "opaque-value" },
			}),
		});
		assert.equal(
			cipherResponse.status,
			200,
			await cipherResponse.clone().text(),
		);
		const cipher = await cipherResponse.json<{
			id: string;
			folderId: string | null;
			favorite: boolean;
			fields: unknown[];
			edit: boolean;
			viewPassword: boolean;
			object: string;
			revisionDate: string;
			futureClientField: { encrypted: string };
		}>();
		cipherId = cipher.id;
		assert.equal(cipher.folderId, folder.id);
		assert.equal(cipher.favorite, true);
		assert.equal(cipher.fields.length, 1);
		assert.deepEqual(cipher.futureClientField, { encrypted: "opaque-value" });
		assert.deepEqual(
			[cipher.edit, cipher.viewPassword, cipher.object],
			[true, true, "cipherDetails"],
		);

		const sync = await request("/api/sync", { headers: auth });
		assert.equal(sync.status, 200);
		const syncBody = await sync.json<{
			folders: unknown[];
			ciphers: unknown[];
		}>();
		assert.equal(syncBody.folders.length, 1);
		assert.equal(syncBody.ciphers.length, 1);

		const updatePayload = {
			type: 1,
			name: "newer-encrypted-name",
			folderId: folder.id,
			login: { username: "encrypted-user", password: "encrypted-pass" },
			fields: [{ name: "encrypted-field", value: "encrypted-value" }],
			lastKnownRevisionDate: cipher.revisionDate,
			futureClientField: { encrypted: "opaque-value" },
		};
		const updatedResponse = await request(`/api/ciphers/${cipher.id}`, {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify(updatePayload),
		});
		assert.equal(
			updatedResponse.status,
			200,
			await updatedResponse.clone().text(),
		);
		const updated = await updatedResponse.json<{
			name: string;
			revisionDate: string;
			futureClientField: { encrypted: string };
		}>();
		assert.equal(updated.name, "newer-encrypted-name");
		assert.notEqual(updated.revisionDate, cipher.revisionDate);
		assert.deepEqual(updated.futureClientField, { encrypted: "opaque-value" });

		const staleResponse = await request(`/api/ciphers/${cipher.id}`, {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ ...updatePayload, name: "stale-encrypted-name" }),
		});
		assert.equal(staleResponse.status, 409);
		const currentResponse = await request(`/api/ciphers/${cipher.id}`, {
			headers: auth,
		});
		assert.equal(currentResponse.status, 200);
		assert.equal(
			(await currentResponse.json<{ name: string }>()).name,
			"newer-encrypted-name",
		);
	});

	test("syncs a vault larger than D1's bound-parameter limit", async () => {
		const user = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);
		const timestamp = Math.floor(Date.now() / 1000);
		const cipherIds = Array.from(
			{ length: 150 },
			(_, index) => `large-sync-${index}`,
		);
		const statements = cipherIds.map((id) =>
			testDatabase
				.prepare(
					"INSERT INTO ciphers (id, user_id, type, name, data, favorite, reprompt, created_at, updated_at) VALUES (?, ?, 1, ?, '{}', 0, 0, ?, ?)",
				)
				.bind(id, user.id, `encrypted-${id}`, timestamp, timestamp),
		);

		try {
			for (let index = 0; index < statements.length; index += 50) {
				await testDatabase.batch(statements.slice(index, index + 50));
			}
			const response = await request("/api/sync", {
				headers: { authorization: `Bearer ${accessToken}` },
			});
			assert.equal(response.status, 200, await response.clone().text());
			const body = await response.json<{ ciphers: Array<{ id: string }> }>();
			assert.equal(
				body.ciphers.filter((cipher) => cipher.id.startsWith("large-sync-"))
					.length,
				cipherIds.length,
			);
			const bulkResponse = await request("/api/ciphers/archive", {
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ ids: cipherIds }),
			});
			assert.equal(bulkResponse.status, 200, await bulkResponse.clone().text());
		} finally {
			await testDatabase
				.prepare("DELETE FROM ciphers WHERE id LIKE 'large-sync-%'")
				.run();
		}
	});

	test("stores auth request access codes as protected credentials", async () => {
		const accessCode = "auth-request-client-secret";
		const response = await request("/api/auth-requests", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				email: EMAIL,
				deviceIdentifier: "auth-request-test-device",
				deviceType: 0,
				accessCode,
				publicKey: "encrypted-auth-request-public-key",
			}),
		});
		assert.equal(response.status, 200, await response.clone().text());
		const body = await response.json<{ id: string; accessCode: string }>();
		assert.equal(body.accessCode, accessCode);
		const stored = await testDatabase
			.prepare(
				"SELECT access_code_hash, access_code_encrypted FROM auth_requests WHERE id = ?",
			)
			.bind(body.id)
			.first<{
				access_code_hash: string;
				access_code_encrypted: string;
			}>();
		assert.equal(stored?.access_code_hash, await hashCredential(accessCode));
		assert.doesNotMatch(
			stored?.access_code_encrypted ?? "",
			new RegExp(accessCode),
		);
	});

	test("fails closed on malformed local account invariants", async () => {
		await assert.rejects(() =>
			testDatabase
				.prepare("UPDATE users SET email = ? WHERE email = ?")
				.bind(EMAIL.toUpperCase(), EMAIL)
				.run(),
		);
		await assert.rejects(() =>
			testDatabase
				.prepare(
					"UPDATE users SET kdf_type = 1, kdf_iterations = 2, kdf_memory = NULL, kdf_parallelism = NULL WHERE email = ?",
				)
				.bind(EMAIL)
				.run(),
		);
		await assert.rejects(() =>
			testDatabase
				.prepare("UPDATE users SET yubikey_config = '{}' WHERE email = ?")
				.bind(EMAIL)
				.run(),
		);
		await assert.rejects(() =>
			testDatabase
				.prepare("UPDATE users SET totp_secret = '{}' WHERE email = ?")
				.bind(EMAIL)
				.run(),
		);
	});

	test("rejects cross-user or missing folder ids at the database boundary", async () => {
		const response = await request("/api/ciphers", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				type: 1,
				name: "invalid-folder-cipher",
				folderId: crypto.randomUUID(),
			}),
		});
		assert.equal(response.status, 400);
	});

	test("bulk deletes only owned folders and moves their ciphers to no folder", async () => {
		const createFolder = async (token: string, name: string) => {
			const response = await request("/api/folders", {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ name }),
			});
			assert.equal(response.status, 200, await response.clone().text());
			return (await response.json<{ id: string }>()).id;
		};
		const firstId = await createFolder(accessToken, "encrypted-bulk-one");
		const secondId = await createFolder(accessToken, "encrypted-bulk-two");
		const otherUserId = await createFolder(
			memberAccessToken,
			"encrypted-other-user",
		);
		await testDatabase
			.prepare("UPDATE ciphers SET folder_id = ? WHERE id = ?")
			.bind(firstId, cipherId)
			.run();

		const invalid = await request("/api/folders/delete", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ids: [] }),
		});
		assert.equal(invalid.status, 400);
		const deleted = await request("/api/folders/delete", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ids: [firstId, secondId, secondId, otherUserId] }),
		});
		assert.equal(deleted.status, 204, await deleted.clone().text());

		assert.deepEqual(
			await testDatabase
				.prepare("SELECT COUNT(*) AS count FROM folders WHERE id IN (?, ?)")
				.bind(firstId, secondId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			0,
		);
		assert.equal(
			await testDatabase
				.prepare("SELECT COUNT(*) AS count FROM folders WHERE id = ?")
				.bind(otherUserId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
		assert.equal(
			await testDatabase
				.prepare("SELECT folder_id FROM ciphers WHERE id = ?")
				.bind(cipherId)
				.first<{ folder_id: string | null }>()
				.then((row) => row?.folder_id),
			null,
		);
	});

	test("validates device updates and hides resources outside the user scope", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const ownDevice = await request("/api/devices/api-test-device", {
			headers: auth,
		});
		assert.equal(ownDevice.status, 200);

		const invalidName = await request("/api/devices/api-test-device/name", {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ name: "" }),
		});
		assert.equal(invalidName.status, 400);

		const missingDevice = await request(`/api/devices/${crypto.randomUUID()}`, {
			headers: auth,
		});
		assert.equal(missingDevice.status, 404);

		const unverifiedDeleteAll = await request("/api/devices", {
			method: "DELETE",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ masterPasswordHash: "wrong-password" }),
		});
		assert.equal(unverifiedDeleteAll.status, 400);
		assert.equal(
			(await request("/api/devices/api-test-device", { headers: auth })).status,
			200,
		);

		const secondaryLogin = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
				deviceIdentifier: "secondary-device",
				deviceName: "Secondary",
				deviceType: "14",
			}),
		});
		assert.equal(
			secondaryLogin.status,
			200,
			await secondaryLogin.clone().text(),
		);
		const secondaryToken = (
			await secondaryLogin.json<{ access_token: string }>()
		).access_token;
		const bulkRemoved = await request("/api/devices/delete", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ ids: ["secondary-device", "member-test-device"] }),
		});
		assert.equal(bulkRemoved.status, 200, await bulkRemoved.clone().text());
		assert.equal((await bulkRemoved.json<{ deleted: number }>()).deleted, 1);
		assert.equal(
			(
				await request("/api/accounts/profile", {
					headers: { authorization: `Bearer ${secondaryToken}` },
				})
			).status,
			401,
		);
		assert.equal(
			await testDatabase
				.prepare(
					"SELECT COUNT(*) AS count FROM devices WHERE device_identifier = 'member-test-device'",
				)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
	});

	test("validates domain settings before persistence", async () => {
		const response = await request("/api/settings/domains", {
			method: "PUT",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ excludedGlobalEquivalentDomains: "invalid" }),
		});
		assert.equal(response.status, 400);
	});

	test("uses cipher ownership middleware for soft-delete and restore", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const missing = await request(`/api/ciphers/${crypto.randomUUID()}`, {
			headers: auth,
		});
		assert.equal(missing.status, 404);

		const deleted = await request(`/api/ciphers/${cipherId}/delete`, {
			method: "PUT",
			headers: auth,
		});
		assert.equal(deleted.status, 200);
		const trashedCipher = await request(`/api/ciphers/${cipherId}`, {
			headers: auth,
		});
		assert.equal(trashedCipher.status, 200);
		assert.ok(
			(await trashedCipher.json<{ deletedDate: string | null }>()).deletedDate,
		);

		const restored = await request(`/api/ciphers/${cipherId}/restore`, {
			method: "PUT",
			headers: auth,
		});
		assert.equal(restored.status, 200);
		assert.equal(
			(await restored.json<{ deletedDate: string | null }>()).deletedDate,
			null,
		);
	});

	test("archives and unarchives owned ciphers through single and bulk routes", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const archived = await request(`/api/ciphers/${cipherId}/archive`, {
			method: "PUT",
			headers: auth,
		});
		assert.equal(archived.status, 200, await archived.clone().text());
		assert.ok(
			(await archived.json<{ archivedDate: string | null }>()).archivedDate,
		);

		const hidden = await request(`/api/ciphers/${cipherId}/archive`, {
			method: "PUT",
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(hidden.status, 404);

		const unarchived = await request("/api/ciphers/unarchive", {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ ids: [cipherId] }),
		});
		assert.equal(unarchived.status, 200, await unarchived.clone().text());
		const cipher = await request(`/api/ciphers/${cipherId}`, { headers: auth });
		assert.equal(
			(await cipher.json<{ archivedDate: string | null }>()).archivedDate,
			null,
		);

		const bulkArchived = await request("/api/ciphers/archive", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ ids: [cipherId] }),
		});
		assert.equal(bulkArchived.status, 200, await bulkArchived.clone().text());
		const restored = await request(`/api/ciphers/${cipherId}/unarchive`, {
			method: "POST",
			headers: auth,
		});
		assert.equal(restored.status, 200, await restored.clone().text());
		assert.equal(
			(await restored.json<{ archivedDate: string | null }>()).archivedDate,
			null,
		);
	});

	test("matches Vaultwarden cipher and folder method compatibility semantics", async () => {
		const auth = {
			authorization: `Bearer ${accessToken}`,
			"content-type": "application/json",
		};
		const folderResponse = await request("/api/folders", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ name: "encrypted-compat-folder" }),
		});
		const folderId = (await folderResponse.json<{ id: string }>()).id;
		assert.equal(
			(
				await request(`/api/folders/${folderId}`, {
					method: "POST",
					headers: auth,
					body: JSON.stringify({ name: "encrypted-renamed-folder" }),
				})
			).status,
			200,
		);
		assert.equal(
			(
				await request("/api/ciphers/move", {
					method: "PUT",
					headers: auth,
					body: JSON.stringify({ ids: [cipherId], folderId }),
				})
			).status,
			200,
		);
		assert.equal(
			(
				await (
					await request(`/api/ciphers/${cipherId}`, { headers: auth })
				).json<{ folderId: string | null }>()
			).folderId,
			folderId,
		);
		assert.equal(
			(
				await request("/api/ciphers/move", {
					method: "POST",
					headers: auth,
					body: JSON.stringify({ ids: [cipherId], folderId: null }),
				})
			).status,
			200,
		);

		const createCipher = async (name: string) => {
			const response = await request("/api/ciphers/create", {
				method: "POST",
				headers: auth,
				body: JSON.stringify({
					type: 1,
					name,
					login: { username: "encrypted-user", password: "encrypted-password" },
				}),
			});
			assert.equal(response.status, 200, await response.clone().text());
			return (await response.json<{ id: string }>()).id;
		};
		const singleId = await createCipher("encrypted-single-delete");
		assert.equal(
			(
				await request(`/api/ciphers/${singleId}`, {
					method: "POST",
					headers: auth,
					body: JSON.stringify({
						type: 1,
						name: "encrypted-updated",
						login: {
							username: "encrypted-user",
							password: "encrypted-password",
						},
					}),
				})
			).status,
			200,
		);
		assert.equal(
			(
				await request(`/api/ciphers/${singleId}`, {
					method: "DELETE",
					headers: auth,
				})
			).status,
			200,
		);
		assert.equal(
			(await request(`/api/ciphers/${singleId}`, { headers: auth })).status,
			404,
		);

		const softId = await createCipher("encrypted-bulk-soft-delete");
		assert.equal(
			(
				await request("/api/ciphers/delete", {
					method: "PUT",
					headers: auth,
					body: JSON.stringify({ ids: [softId] }),
				})
			).status,
			200,
		);
		assert.ok(
			(
				await (
					await request(`/api/ciphers/${softId}`, { headers: auth })
				).json<{ deletedDate: string | null }>()
			).deletedDate,
		);
		assert.equal(
			(
				await request("/api/ciphers/delete", {
					method: "POST",
					headers: auth,
					body: JSON.stringify({ ids: [softId] }),
				})
			).status,
			200,
		);
		assert.equal(
			(await request(`/api/ciphers/${softId}`, { headers: auth })).status,
			404,
		);
		assert.equal(
			(
				await request(`/api/folders/${folderId}/delete`, {
					method: "POST",
					headers: auth,
				})
			).status,
			200,
		);
	});

	test("uploads encrypted attachments with scoped short-lived URLs", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const encryptedBytes = new TextEncoder().encode(
			"encrypted-attachment-payload",
		);
		const created = await request(`/api/ciphers/${cipherId}/attachment/v2`, {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({
				fileName: "2.encrypted-file-name",
				key: "2.encrypted-attachment-key",
				fileSize: encryptedBytes.byteLength,
			}),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const metadata = await created.json<{
			attachmentId: string;
			url: string;
		}>();

		const crossUser = await request(
			`/api/ciphers/${cipherId}/attachment/${metadata.attachmentId}`,
			{
				headers: { authorization: `Bearer ${memberAccessToken}` },
			},
		);
		assert.equal(crossUser.status, 404);

		const uploadUrl = new URL(metadata.url);
		const wrongSize = await request(
			`${uploadUrl.pathname}${uploadUrl.search}`,
			{
				method: "PUT",
				headers: {
					"content-type": "application/octet-stream",
					"content-length": "1",
				},
				body: new Uint8Array([1]),
			},
		);
		assert.equal(wrongSize.status, 400);

		const uploaded = await request(`${uploadUrl.pathname}${uploadUrl.search}`, {
			method: "PUT",
			headers: {
				"content-type": "application/octet-stream",
				"content-length": String(encryptedBytes.byteLength),
			},
			body: encryptedBytes,
		});
		assert.equal(uploaded.status, 201, await uploaded.clone().text());

		const replay = await request(`${uploadUrl.pathname}${uploadUrl.search}`, {
			method: "PUT",
			headers: {
				"content-type": "application/octet-stream",
				"content-length": String(encryptedBytes.byteLength),
			},
			body: encryptedBytes,
		});
		assert.equal(replay.status, 409);

		const downloaded = await request(
			`/api/ciphers/${cipherId}/attachment/${metadata.attachmentId}`,
			{ headers: auth },
		);
		assert.equal(downloaded.status, 200, await downloaded.clone().text());
		assert.deepEqual(
			new Uint8Array(await downloaded.arrayBuffer()),
			encryptedBytes,
		);
		assert.equal(downloaded.headers.get("cache-control"), "private, no-store");

		const cipher = await request(`/api/ciphers/${cipherId}`, { headers: auth });
		const attachment = (
			await cipher.json<{
				attachments: Array<{ id: string; fileName: string; key: string }>;
			}>()
		).attachments[0];
		assert.equal(attachment.id, metadata.attachmentId);
		assert.equal(attachment.fileName, "2.encrypted-file-name");
		assert.equal(attachment.key, "2.encrypted-attachment-key");

		const backup = await request("/api/admin/backup/export", {
			method: "POST",
			headers: {
				...auth,
				"content-type": "application/json",
			},
			body: JSON.stringify({ includeAttachments: true }),
		});
		assert.equal(backup.status, 200, await backup.clone().text());
		const backupFiles = unzipSync(new Uint8Array(await backup.arrayBuffer()));
		assert.deepEqual(
			backupFiles[`attachments/${cipherId}/${metadata.attachmentId}.bin`],
			encryptedBytes,
		);
		const manifest = JSON.parse(
			new TextDecoder().decode(backupFiles["manifest.json"]),
		) as { storageKind: string; blobSummary: { attachmentFiles: number } };
		assert.equal(manifest.storageKind, "r2");
		assert.equal(manifest.blobSummary.attachmentFiles, 1);

		const removed = await request(
			`/api/ciphers/${cipherId}/attachment/${metadata.attachmentId}/delete`,
			{ method: "POST", headers: auth },
		);
		assert.equal(removed.status, 204, await removed.clone().text());
		const gone = await request(
			`/api/ciphers/${cipherId}/attachment/${metadata.attachmentId}`,
			{ headers: auth },
		);
		assert.equal(gone.status, 404);
	});

	test("validates and creates a text Send with an atomic revision update", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const invalid = await request("/api/sends", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ type: 0, name: "missing-required-fields" }),
		});
		assert.equal(invalid.status, 400);

		const created = await request("/api/sends", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({
				type: 0,
				name: "encrypted-send-name",
				key: "encrypted-send-key",
				text: { text: "encrypted-send-text", hidden: false },
				deletionDate: new Date(Date.now() + 86_400_000).toISOString(),
			}),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const send = await created.json<{ id: string; accessId: string }>();
		sendId = send.id;
		sendAccessId = send.accessId;
	});

	test("serves public Sends while private Send middleware hides unknown ids", async () => {
		const missing = await request(`/api/sends/${crypto.randomUUID()}`, {
			headers: { authorization: `Bearer ${accessToken}` },
		});
		assert.equal(missing.status, 404);

		const accessed = await request(`/api/sends/access/${sendAccessId}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		assert.equal(accessed.status, 200, await accessed.clone().text());
		const body = await accessed.json<{
			id: string;
			text: { text: string };
		}>();
		assert.equal(body.id, sendId);
		assert.equal(body.text.text, "encrypted-send-text");
	});

	test("updates text Send data without replacing it with an incompatible shape", async () => {
		const updated = await request(`/api/sends/${sendId}`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				text: { text: "updated-encrypted-text", hidden: false },
			}),
		});
		assert.equal(updated.status, 200, await updated.clone().text());
		assert.equal(
			(await updated.json<{ text: { text: string } }>()).text.text,
			"updated-encrypted-text",
		);

		const accessed = await request(`/api/sends/access/${sendAccessId}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		assert.equal(accessed.status, 200);
		assert.equal(
			(await accessed.json<{ text: { text: string } }>()).text.text,
			"updated-encrypted-text",
		);
	});

	test("validates passkey requests before WebAuthn processing", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const invalidOptions = await request("/api/webauthn/attestation-options", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		assert.equal(invalidOptions.status, 400);

		const unknownCredential = await request(
			`/api/webauthn/${crypto.randomUUID()}/delete`,
			{
				method: "POST",
				headers: { ...auth, "content-type": "application/json" },
				body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }),
			},
		);
		assert.equal(unknownCredential.status, 404);
	});

	test("includes independently stored cipher fields and Sends in sync", async () => {
		const response = await request("/api/sync", {
			headers: { authorization: `Bearer ${accessToken}` },
		});
		assert.equal(response.status, 200);
		const sync = await response.json<{
			ciphers: Array<{ id: string; fields: unknown[] | null }>;
			sends: Array<{ id: string }>;
		}>();
		assert.equal(
			sync.ciphers.find((cipher) => cipher.id === cipherId)?.fields?.length,
			1,
		);
		assert.ok(sync.sends.some((send) => send.id === sendId));
	});

	test("bulk deletes only Sends owned by the authenticated user", async () => {
		const createSend = async (token: string, name: string) => {
			const response = await request("/api/sends", {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					type: 0,
					name,
					key: "encrypted-key",
					text: { text: "encrypted-text", hidden: false },
					deletionDate: new Date(Date.now() + 86_400_000).toISOString(),
				}),
			});
			assert.equal(response.status, 200, await response.clone().text());
			return (await response.json<{ id: string }>()).id;
		};
		const ownedId = await createSend(accessToken, "encrypted-bulk-send");
		const otherUserId = await createSend(
			memberAccessToken,
			"encrypted-other-send",
		);
		const deleted = await request("/api/sends/delete", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ids: [ownedId, otherUserId] }),
		});
		assert.equal(deleted.status, 200, await deleted.clone().text());
		assert.equal(
			await testDatabase
				.prepare("SELECT COUNT(*) AS count FROM sends WHERE id = ?")
				.bind(ownedId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			0,
		);
		assert.equal(
			await testDatabase
				.prepare("SELECT COUNT(*) AS count FROM sends WHERE id = ?")
				.bind(otherUserId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
	});

	test("validates backup settings before normalization", async () => {
		const response = await request("/api/admin/backup/settings", {
			method: "PUT",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				destinations: [{ type: "local", destination: {} }],
			}),
		});
		assert.equal(response.status, 400);
	});

	test("enforces admin authorization through shared middleware", async () => {
		const response = await request("/api/admin/backup/settings", {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(response.status, 403);
	});

	test("manages users and one-time invites with admin password re-verification", async () => {
		const adminAuth = { authorization: `Bearer ${accessToken}` };
		const memberDenied = await request("/api/admin/users", {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(memberDenied.status, 403);

		const users = await request("/api/admin/users", { headers: adminAuth });
		assert.equal(users.status, 200, await users.clone().text());
		const userRows = (
			await users.json<{
				data: Array<{ id: string; email: string; status: string }>;
			}>()
		).data;
		const member = userRows.find((user) => user.email === MEMBER_EMAIL);
		assert.ok(member);

		const wrongPassword = await request("/api/admin/invites", {
			method: "POST",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({ masterPasswordHash: "wrong", expiresInHours: 24 }),
		});
		assert.equal(wrongPassword.status, 400);

		const wrongPolicyPassword = await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: "wrong",
				signupsAllowed: false,
				invitationsAllowed: true,
			}),
		});
		assert.equal(wrongPolicyPassword.status, 400);
		const savedPolicy = await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				signupsAllowed: false,
				invitationsAllowed: true,
			}),
		});
		assert.equal(savedPolicy.status, 200, await savedPolicy.clone().text());
		assert.deepEqual(await savedPolicy.json(), {
			signupsAllowed: false,
			invitationsAllowed: true,
			object: "registrationPolicy",
		});

		const created = await request("/api/admin/invites", {
			method: "POST",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				email: "invited-api-test@example.com",
				expiresInHours: 24,
			}),
		});
		assert.equal(created.status, 201, await created.clone().text());
		const invite = await created.json<{
			code: string;
			email: string;
			status: string;
			inviteLink: string;
		}>();
		assert.equal(invite.status, "active");
		assert.equal(invite.email, "invited-api-test@example.com");
		assert.match(
			invite.inviteLink,
			new RegExp(`/register\\?invite=${invite.code}$`),
		);
		const storedInvite = await testDatabase
			.prepare("SELECT code, code_encrypted FROM invites WHERE code = ?")
			.bind(await hashCredential(invite.code))
			.first<{ code: string; code_encrypted: string }>();
		assert.ok(storedInvite);
		assert.notEqual(storedInvite.code, invite.code);
		assert.doesNotMatch(storedInvite.code_encrypted, new RegExp(invite.code));

		await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				signupsAllowed: false,
				invitationsAllowed: false,
			}),
		});
		const disabledInvite = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "disabled-invite@example.com",
				masterPasswordHash: MASTER_PASSWORD_HASH,
				key: "encrypted-key",
				kdf: 0,
				kdfIterations: 600_000,
				inviteCode: invite.code,
			}),
		});
		assert.equal(disabledInvite.status, 400);
		await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				signupsAllowed: false,
				invitationsAllowed: true,
			}),
		});
		const invitedPayload = (email: string) => ({
			email,
			name: "Invited Test",
			masterPasswordHash: MASTER_PASSWORD_HASH,
			key: "encrypted-invited-key",
			kdf: 0,
			kdfIterations: 600_000,
			inviteCode: invite.code,
		});
		const wrongEmail = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(invitedPayload("invite-race@example.com")),
		});
		assert.equal(wrongEmail.status, 400);
		assert.equal(
			(await wrongEmail.json<{ message: string }>()).message,
			"Invite does not match this email address",
		);
		const competingRegistrations = await Promise.all([
			request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(invitedPayload("invited-api-test@example.com")),
			}),
			request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(invitedPayload("INVITED-API-TEST@EXAMPLE.COM")),
			}),
		]);
		const competingStatuses = competingRegistrations.map(
			(response) => response.status,
		);
		assert.equal(
			competingStatuses.filter((status) => status === 204).length,
			1,
		);
		assert.ok(
			competingStatuses.every((status) => [204, 400, 409].includes(status)),
		);

		const replayInvite = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "invite-replay@example.com",
				masterPasswordHash: MASTER_PASSWORD_HASH,
				key: "key",
				kdf: 0,
				kdfIterations: 600_000,
				inviteCode: invite.code,
			}),
		});
		assert.equal(replayInvite.status, 400);
		await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				signupsAllowed: true,
				invitationsAllowed: true,
			}),
		});

		const banned = await request(`/api/admin/users/${member.id}/status`, {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				status: "banned",
				masterPasswordHash: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(banned.status, 200, await banned.clone().text());
		const restored = await request(`/api/admin/users/${member.id}/status`, {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				status: "active",
				masterPasswordHash: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(restored.status, 200, await restored.clone().text());
		const relogin = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: MEMBER_EMAIL,
				password: MASTER_PASSWORD_HASH,
				deviceIdentifier: "member-test-device-restored",
				deviceName: "Restored Member Device",
				deviceType: "0",
			}),
		});
		assert.equal(relogin.status, 200, await relogin.clone().text());
		memberAccessToken = (await relogin.json<{ access_token: string }>())
			.access_token;

		const logs = await request("/api/admin/logs?category=admin&limit=20", {
			headers: adminAuth,
		});
		assert.equal(logs.status, 200, await logs.clone().text());
		const entries = (
			await logs.json<{
				data: Array<{ action: string; metadata: Record<string, unknown> }>;
			}>()
		).data;
		assert.ok(entries.some((entry) => entry.action === "admin.invite.create"));
		assert.ok(entries.some((entry) => entry.action === "admin.user.status"));
		assert.ok(
			entries.every(
				(entry) =>
					!JSON.stringify(entry.metadata).match(
						/masterPasswordHash|test-secret|encrypted-/i,
					),
			),
		);

		const defaultSettings = await request("/api/admin/logs/settings", {
			headers: adminAuth,
		});
		assert.equal(defaultSettings.status, 200);
		assert.deepEqual(
			await defaultSettings
				.json<any>()
				.then((value) => [value.retentionDays, value.maxEntries]),
			[90, null],
		);
		assert.equal(
			(
				await request("/api/admin/logs/settings", {
					headers: { authorization: `Bearer ${memberAccessToken}` },
				})
			).status,
			403,
		);
		const updatedSettings = await request("/api/admin/logs/settings", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({ retentionDays: null, maxEntries: 100 }),
		});
		assert.equal(
			updatedSettings.status,
			200,
			await updatedSettings.clone().text(),
		);
		assert.deepEqual(
			await updatedSettings
				.json<any>()
				.then((value) => [value.retentionDays, value.maxEntries]),
			[null, 100],
		);
	});

	test("resource middleware prevents cross-user cipher access", async () => {
		const response = await request(`/api/ciphers/${cipherId}`, {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(response.status, 404);
	});

	test("enforces organization collection visibility and read-only writes", async () => {
		const owner = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		const restrictedUser = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(MEMBER_EMAIL)
			.first<{ id: string }>();
		assert.ok(owner?.id && restrictedUser?.id);
		const timestamp = Math.floor(Date.now() / 1000);
		const orgId = crypto.randomUUID();
		const ownerMemberId = crypto.randomUUID();
		const restrictedMemberId = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		const otherOrgId = crypto.randomUUID();
		const otherCollectionId = crypto.randomUUID();
		await testDatabase.batch([
			testDatabase
				.prepare(
					"INSERT INTO organizations (id,name,owner_id,public_key,private_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
				)
				.bind(
					orgId,
					"Test organization",
					owner.id,
					"public",
					"private",
					timestamp,
					timestamp,
				),
			testDatabase
				.prepare(
					"INSERT INTO org_members (id,org_id,user_id,email,role,status,access_all,key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					ownerMemberId,
					orgId,
					owner.id,
					EMAIL,
					"owner",
					"confirmed",
					1,
					"owner-key",
					timestamp,
					timestamp,
				),
			testDatabase
				.prepare(
					"INSERT INTO org_members (id,org_id,user_id,email,role,status,access_all,key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					restrictedMemberId,
					orgId,
					restrictedUser.id,
					MEMBER_EMAIL,
					"member",
					"confirmed",
					0,
					"member-key",
					timestamp,
					timestamp,
				),
			testDatabase
				.prepare(
					"INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
				)
				.bind(
					collectionId,
					orgId,
					"encrypted-collection",
					timestamp,
					timestamp,
				),
			testDatabase
				.prepare(
					"INSERT INTO collection_members (collection_id,org_member_id,read_only,hide_passwords) VALUES (?,?,1,0)",
				)
				.bind(collectionId, restrictedMemberId),
			testDatabase
				.prepare(
					"INSERT INTO organizations (id,name,owner_id,created_at,updated_at) VALUES (?,?,?,?,?)",
				)
				.bind(otherOrgId, "Other organization", owner.id, timestamp, timestamp),
			testDatabase
				.prepare(
					"INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
				)
				.bind(
					otherCollectionId,
					otherOrgId,
					"other-organization-collection",
					timestamp,
					timestamp,
				),
		]);
		const restrictedCollections = await request("/api/collections", {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(
			restrictedCollections.status,
			200,
			await restrictedCollections.clone().text(),
		);
		assert.deepEqual(
			(
				await restrictedCollections.json<{
					data: Array<{ id: string; readOnly: boolean }>;
				}>()
			).data.map((collection) => [collection.id, collection.readOnly]),
			[[collectionId, true]],
		);
		const ownerCollections = await request("/api/collections", {
			headers: { authorization: `Bearer ${accessToken}` },
		});
		assert.deepEqual(
			(
				await ownerCollections.json<{
					data: Array<{ id: string; readOnly: boolean }>;
				}>()
			).data.map((collection) => [collection.id, collection.readOnly]),
			[[collectionId, false]],
		);
		assert.equal(
			(
				await request(`/api/organizations/${orgId}`, {
					method: "POST",
					headers: {
						authorization: `Bearer ${accessToken}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({ name: "Renamed organization" }),
				})
			).status,
			200,
		);

		const payload = {
			type: 1,
			name: "encrypted-name",
			notes: null,
			favorite: false,
			folderId: null,
			organizationId: orgId,
			collectionIds: [collectionId],
			key: "encrypted-item-key",
			login: { username: "encrypted-user", password: "encrypted-password" },
		};
		const crossOrganizationWrite = await request("/api/ciphers", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				...payload,
				name: "cross-organization-cipher",
				collectionIds: [otherCollectionId],
			}),
		});
		assert.equal(crossOrganizationWrite.status, 404);
		const created = await request("/api/ciphers", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const cipher = await created.json<{
			id: string;
			organizationId: string;
			collectionIds: string[];
		}>();
		assert.equal(cipher.organizationId, orgId);
		assert.deepEqual(cipher.collectionIds, [collectionId]);
		const stored = await testDatabase
			.prepare("SELECT user_id, org_id, folder_id FROM ciphers WHERE id = ?")
			.bind(cipher.id)
			.first<{
				user_id: string | null;
				org_id: string;
				folder_id: string | null;
			}>();
		assert.deepEqual(stored, { user_id: null, org_id: orgId, folder_id: null });

		const secondCollectionId = crypto.randomUUID();
		await testDatabase.batch([
			testDatabase
				.prepare(
					"INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
				)
				.bind(
					secondCollectionId,
					orgId,
					"second-encrypted-collection",
					timestamp,
					timestamp,
				),
			testDatabase
				.prepare(
					"INSERT INTO collection_members (collection_id,org_member_id,read_only,hide_passwords) VALUES (?,?,1,0)",
				)
				.bind(secondCollectionId, restrictedMemberId),
			testDatabase
				.prepare(
					"INSERT INTO cipher_collections (cipher_id,collection_id) VALUES (?,?)",
				)
				.bind(cipher.id, secondCollectionId),
		]);
		const restrictedSync = await request("/api/sync", {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(
			restrictedSync.status,
			200,
			await restrictedSync.clone().text(),
		);
		const syncedCipherRows = (
			await restrictedSync.json<{
				ciphers: Array<{ id: string; collectionIds: string[] }>;
			}>()
		).ciphers.filter((item) => item.id === cipher.id);
		assert.equal(syncedCipherRows.length, 1);
		assert.deepEqual(
			new Set(syncedCipherRows[0].collectionIds),
			new Set([collectionId, secondCollectionId]),
		);
		await testDatabase.batch([
			testDatabase
				.prepare(
					"DELETE FROM cipher_collections WHERE cipher_id = ? AND collection_id = ?",
				)
				.bind(cipher.id, secondCollectionId),
			testDatabase
				.prepare("DELETE FROM collections WHERE id = ?")
				.bind(secondCollectionId),
		]);

		const visible = await request(`/api/ciphers/${cipher.id}`, {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(visible.status, 200, await visible.clone().text());
		assert.deepEqual(
			await visible
				.json<{
					edit: boolean;
					viewPassword: boolean;
					permissions: { delete: boolean; restore: boolean };
				}>()
				.then((value) => [
					value.edit,
					value.viewPassword,
					value.permissions.delete,
					value.permissions.restore,
				]),
			[false, true, false, false],
		);
		const deniedWrite = await request(`/api/ciphers/${cipher.id}`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${memberAccessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		assert.equal(deniedWrite.status, 403);
		await testDatabase
			.prepare("UPDATE org_members SET role = 'manager' WHERE id = ?")
			.bind(restrictedMemberId)
			.run();
		assert.equal(
			(
				await request(
					`/api/organizations/${orgId}/collections/${collectionId}`,
					{
						method: "POST",
						headers: {
							authorization: `Bearer ${memberAccessToken}`,
							"content-type": "application/json",
						},
						body: JSON.stringify({ name: "encrypted-renamed-collection" }),
					},
				)
			).status,
			200,
		);
		const escalation = await request(`/api/organizations/${orgId}/members`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${memberAccessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				email: "nobody@example.com",
				role: "admin",
				accessAll: true,
				collections: [],
				key: "encrypted-key",
			}),
		});
		assert.equal(escalation.status, 403);

		await testDatabase
			.prepare(
				"DELETE FROM collection_members WHERE collection_id = ? AND org_member_id = ?",
			)
			.bind(collectionId, restrictedMemberId)
			.run();
		assert.deepEqual(
			(
				await (
					await request("/api/collections", {
						headers: { authorization: `Bearer ${memberAccessToken}` },
					})
				).json<{ data: unknown[] }>()
			).data,
			[],
		);
		const hidden = await request(`/api/ciphers/${cipher.id}`, {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(hidden.status, 404);

		// Instance backups must preserve the complete organization graph while
		// excluding machine credentials such as API keys.
		const apiKeyResponse = await request("/api/accounts/rotate-api-key", {
			method: "POST",
			headers: { authorization: `Bearer ${accessToken}` },
		});
		assert.equal(
			apiKeyResponse.status,
			200,
			await apiKeyResponse.clone().text(),
		);
		const apiKey = (await apiKeyResponse.json<{ apiKey: string }>()).apiKey;
		const persistedApiKey = await testDatabase
			.prepare("SELECT api_key_hash, api_key_encrypted FROM users WHERE id = ?")
			.bind(owner.id)
			.first<{ api_key_hash: string; api_key_encrypted: string }>();
		assert.equal(persistedApiKey?.api_key_hash, await hashCredential(apiKey));
		assert.doesNotMatch(
			persistedApiKey?.api_key_encrypted ?? "",
			new RegExp(apiKey),
		);
		const apiSession = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: `user.${owner.id}`,
				client_secret: apiKey,
			}),
		});
		assert.equal(apiSession.status, 200, await apiSession.clone().text());
		const backupResponse = await request("/api/admin/backup/export", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ includeAttachments: false }),
		});
		assert.equal(
			backupResponse.status,
			200,
			await backupResponse.clone().text(),
		);
		organizationBackup = new Uint8Array(await backupResponse.arrayBuffer());
		const backupDb = JSON.parse(
			new TextDecoder().decode(unzipSync(organizationBackup)["db.json"]),
		) as {
			users: Array<Record<string, unknown>>;
			organizations: Array<{ id: string }>;
			collections: Array<{ id: string }>;
			cipher_collections: Array<{ cipher_id: string; collection_id: string }>;
		};
		assert.equal(
			backupDb.users.some(
				(row) => "api_key_hash" in row || "api_key_encrypted" in row,
			),
			false,
		);
		assert.ok(backupDb.organizations.some((row) => row.id === orgId));
		assert.ok(backupDb.collections.some((row) => row.id === collectionId));
		assert.ok(
			backupDb.cipher_collections.some(
				(row) =>
					row.cipher_id === cipher.id && row.collection_id === collectionId,
			),
		);
		backedUpOrganizationId = orgId;
		backedUpCollectionId = collectionId;

		const removed = await request(
			`/api/organizations/${orgId}/members/${restrictedMemberId}`,
			{ method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
		);
		assert.equal(removed.status, 204, await removed.clone().text());
		assert.equal(
			(
				await request(`/api/organizations/${orgId}`, {
					headers: { authorization: `Bearer ${memberAccessToken}` },
				})
			).status,
			404,
		);
	});

	test("database enforces cipher ownership and type invariants", async () => {
		const { db } = await createDatabase(testDatabase);
		try {
			const timestamp = Math.floor(Date.now() / 1000);
			const baseCipher = {
				id: crypto.randomUUID(),
				user_id: null,
				org_id: null,
				type: 1,
				folder_id: null,
				name: "invalid-owner",
				notes: null,
				fields: null,
				password_history: null,
				favorite: 0,
				data: "{}",
				reprompt: 0,
				key: null,
				created_at: timestamp,
				updated_at: timestamp,
				archived_at: null,
				deleted_at: null,
				purge_after: null,
			};

			await assert.rejects(() =>
				db.insertInto("ciphers").values(baseCipher).execute(),
			);

			const user = await db
				.selectFrom("users")
				.select("id")
				.where("email", "=", EMAIL)
				.executeTakeFirstOrThrow();
			await assert.rejects(() =>
				db
					.insertInto("ciphers")
					.values({
						...baseCipher,
						id: crypto.randomUUID(),
						user_id: user.id,
						type: 9,
					})
					.execute(),
			);
		} finally {
			await db.destroy();
		}
	});

	test("scheduled maintenance removes expired rows and blob objects", async () => {
		const { db } = await createDatabase(testDatabase);
		const timestamp = Math.floor(Date.now() / 1000);
		const user = await db
			.selectFrom("users")
			.select("id")
			.where("email", "=", EMAIL)
			.executeTakeFirstOrThrow();
		const cipherId = crypto.randomUUID();
		const attachmentId = crypto.randomUUID();
		const sendId = crypto.randomUUID();
		const fileId = crypto.randomUUID();
		const refreshToken = `expired-${crypto.randomUUID()}`;
		const expiredChallenge = `expired-${crypto.randomUUID()}`;
		const usedChallenge = `used-${crypto.randomUUID()}`;
		try {
			await db
				.insertInto("refresh_tokens")
				.values({
					token: refreshToken,
					user_id: user.id,
					expires_at: timestamp - 1,
					device_identifier: null,
					device_session_stamp: null,
				})
				.execute();
			await db
				.insertInto("webauthn_challenges")
				.values([
					{
						challenge_hash: expiredChallenge,
						scope: "login",
						user_id: user.id,
						expires_at: timestamp - 1,
						used_at: null,
						created_at: timestamp - 2,
					},
					{
						challenge_hash: usedChallenge,
						scope: "login",
						user_id: user.id,
						expires_at: timestamp + 3600,
						used_at: timestamp - 1,
						created_at: timestamp - 2,
					},
				])
				.execute();
			await db
				.insertInto("ciphers")
				.values({
					id: cipherId,
					user_id: user.id,
					org_id: null,
					type: 1,
					folder_id: null,
					name: "expired-cipher",
					notes: null,
					fields: null,
					password_history: null,
					favorite: 0,
					data: "{}",
					reprompt: 0,
					key: null,
					created_at: timestamp - 2,
					updated_at: timestamp - 2,
					archived_at: null,
					deleted_at: timestamp - 2,
					purge_after: timestamp - 1,
				})
				.execute();
			await db
				.insertInto("attachments")
				.values({
					id: attachmentId,
					cipher_id: cipherId,
					file_name: "encrypted-name",
					size: 3,
					size_name: "3 bytes",
					key: null,
					created_at: timestamp - 2,
				})
				.execute();
			await db
				.insertInto("sends")
				.values({
					id: sendId,
					user_id: user.id,
					org_id: null,
					type: 1,
					name: "expired-send",
					notes: null,
					data: JSON.stringify({ id: fileId }),
					key: "encrypted-key",
					password_hash: null,
					password_salt: null,
					password_iterations: null,
					password_algorithm: null,
					auth_type: 2,
					emails: null,
					max_access_count: null,
					access_count: 0,
					disabled: 0,
					hide_email: null,
					created_at: timestamp - 2,
					updated_at: timestamp - 2,
					expiration_date: null,
					deletion_date: timestamp - 1,
				})
				.execute();

			r2Values.set(
				`attachments/${cipherId}/${attachmentId}.bin`,
				new Uint8Array([1]),
			);
			r2Values.set(`sends/${sendId}/${fileId}`, new Uint8Array([2]));
			const result = await runMaintenance(db, bindings, timestamp);
			assert.ok(result.refreshTokens >= 1);
			assert.ok(result.webauthnChallenges >= 2);
			assert.ok(result.purgedCiphers >= 1);
			assert.ok(result.purgedSends >= 1);
			assert.equal(
				r2Values.has(`attachments/${cipherId}/${attachmentId}.bin`),
				false,
			);
			assert.equal(r2Values.has(`sends/${sendId}/${fileId}`), false);
			assert.deepEqual(
				await db
					.selectFrom("webauthn_challenges")
					.select("challenge_hash")
					.where("challenge_hash", "in", [expiredChallenge, usedChallenge])
					.execute(),
				[],
			);
			assert.equal(
				await db
					.selectFrom("refresh_tokens")
					.select("token")
					.where("token", "=", refreshToken)
					.executeTakeFirst(),
				undefined,
			);
			assert.equal(
				await db
					.selectFrom("ciphers")
					.select("id")
					.where("id", "=", cipherId)
					.executeTakeFirst(),
				undefined,
			);
			assert.equal(
				await db
					.selectFrom("sends")
					.select("id")
					.where("id", "=", sendId)
					.executeTakeFirst(),
				undefined,
			);
		} finally {
			await db.destroy();
		}
	});

	test("rolls back every statement when a Kysely-D1 batch fails", async () => {
		const { db, dialect } = await createDatabase(testDatabase);
		try {
			const user = await db
				.selectFrom("users")
				.select("id")
				.where("email", "=", EMAIL)
				.executeTakeFirstOrThrow();
			const folderId = crypto.randomUUID();
			const timestamp = Math.floor(Date.now() / 1000);
			const insert = db
				.insertInto("folders")
				.values({
					id: folderId,
					user_id: user.id,
					name: "atomic-folder",
					created_at: timestamp,
					updated_at: timestamp,
				})
				.compile();

			await assert.rejects(() => executeBatch(dialect, [insert, insert]));
			const rolledBack = await db
				.selectFrom("folders")
				.select("id")
				.where("id", "=", folderId)
				.executeTakeFirst();
			assert.equal(rolledBack, undefined);
		} finally {
			await db.destroy();
		}
	});

	test("recovers two-factor authentication with two independent secrets", async () => {
		const recoveryCode = "A1B2C3D4E5F60718";
		const [encryptedTotpSecret, encryptedRecoveryCode] = await Promise.all([
			encryptCredential(
				"JBSWY3DPEHPK3PXP",
				DATA_ENCRYPTION_SECRET,
				"totp-secret",
			),
			encryptCredential(recoveryCode, DATA_ENCRYPTION_SECRET, "totp-recovery"),
		]);
		await testDatabase
			.prepare(
				"UPDATE users SET totp_secret = ?, totp_recovery_code = ? WHERE email = ?",
			)
			.bind(encryptedTotpSecret, encryptedRecoveryCode, EMAIL)
			.run();
		const recoveryUser = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		if (recoveryUser) invalidateUserCache(recoveryUser.id);
		const owner = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(owner?.id);
		const securityKeyId = crypto.randomUUID();
		const timestamp = Math.floor(Date.now() / 1000);
		await testDatabase
			.prepare(
				"INSERT INTO webauthn_credentials (id,user_id,name,public_key,credential_id,counter,type,transports,supports_prf,created_at,updated_at,purpose) VALUES (?,?,?,?,?,0,'public-key','[]',0,?,?, 'twoFactor')",
			)
			.bind(
				securityKeyId,
				owner.id,
				"recovery test key",
				"AQID",
				`recover-${securityKeyId}`,
				timestamp,
				timestamp,
			)
			.run();

		const invalid = await request("/identity/accounts/recover-2fa", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: EMAIL,
				masterPasswordHash: MASTER_PASSWORD_HASH,
				recoveryCode: "0000000000000000",
			}),
		});
		assert.equal(invalid.status, 400);

		const recovered = await request("/identity/accounts/recover-2fa", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: EMAIL.toUpperCase(),
				masterPasswordHash: MASTER_PASSWORD_HASH,
				recoveryCode: "a1b2-c3d4-e5f6-0718",
			}),
		});
		assert.equal(recovered.status, 204, await recovered.clone().text());
		const user = await testDatabase
			.prepare(
				"SELECT totp_secret, totp_recovery_code FROM users WHERE email = ?",
			)
			.bind(EMAIL)
			.first<{
				totp_secret: string | null;
				totp_recovery_code: string | null;
			}>();
		assert.equal(user?.totp_secret, null);
		assert.equal(user?.totp_recovery_code, null);
		assert.equal(
			await testDatabase
				.prepare(
					"SELECT COUNT(*) AS count FROM webauthn_credentials WHERE id = ?",
				)
				.bind(securityKeyId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			0,
		);
	});

	test("isolates login passkeys from two-factor WebAuthn credentials", async () => {
		const user = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(MEMBER_EMAIL)
			.first<{ id: string }>();
		assert.ok(user?.id);
		const timestamp = Math.floor(Date.now() / 1000);
		const loginId = crypto.randomUUID();
		const twoFactorId = crypto.randomUUID();
		for (const [id, purpose] of [
			[loginId, "login"],
			[twoFactorId, "twoFactor"],
		] as const) {
			await testDatabase
				.prepare(
					"INSERT INTO webauthn_credentials (id,user_id,name,public_key,credential_id,counter,type,transports,supports_prf,created_at,updated_at,purpose) VALUES (?,?,?,?,?,0,'public-key','[]',0,?,?,?)",
				)
				.bind(
					id,
					user.id,
					`${purpose} key`,
					"AQID",
					`${purpose}-${id}`,
					timestamp,
					timestamp,
					purpose,
				)
				.run();
		}
		const auth = { authorization: `Bearer ${memberAccessToken}` };
		const accountKeys = await request("/api/webauthn", { headers: auth });
		assert.equal(accountKeys.status, 200);
		assert.deepEqual(
			(await accountKeys.json<{ data: Array<{ id: string }> }>()).data.map(
				(item) => item.id,
			),
			[loginId],
		);

		const settings = await request("/api/two-factor/get-webauthn", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }),
		});
		assert.equal(settings.status, 200, await settings.clone().text());
		assert.deepEqual(
			(await settings.json<{ keys: Array<{ id: string }> }>()).keys.map(
				(item) => item.id,
			),
			[twoFactorId],
		);

		const login = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: MEMBER_EMAIL,
				password: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(login.status, 400);
		const challenge = await login.json<any>();
		assert.ok(challenge.TwoFactorProviders.includes("7"));
		assert.ok(challenge.TwoFactorProviders2["7"].Challenge.token);

		const removed = await request("/api/two-factor/webauthn", {
			method: "DELETE",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				id: twoFactorId,
			}),
		});
		assert.equal(removed.status, 200, await removed.clone().text());
		assert.equal((await removed.json<{ enabled: boolean }>()).enabled, false);
		assert.equal(
			await testDatabase
				.prepare(
					"SELECT COUNT(*) AS count FROM webauthn_credentials WHERE id = ?",
				)
				.bind(loginId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
	});

	test("encrypts Yubico validation credentials and advertises YubiKey login", async () => {
		await testDatabase
			.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?")
			.bind(JSON.stringify({ keys: ["ccccccbbbbbb"], nfc: true }), EMAIL)
			.run();
		const yubikeyUser = await testDatabase
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		if (yubikeyUser) invalidateUserCache(yubikeyUser.id);
		const session = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(session.status, 400);
		// Use a newly signed token by temporarily clearing the provider, then restore it before authenticated checks.
		await testDatabase
			.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?")
			.bind(JSON.stringify({ keys: [], nfc: false }), EMAIL)
			.run();
		if (yubikeyUser) invalidateUserCache(yubikeyUser.id);
		const authenticated = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(authenticated.status, 200, await authenticated.clone().text());
		const auth = {
			authorization: `Bearer ${(await authenticated.json<{ access_token: string }>()).access_token}`,
		};
		await testDatabase
			.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?")
			.bind(JSON.stringify({ keys: ["ccccccbbbbbb"], nfc: true }), EMAIL)
			.run();
		if (yubikeyUser) invalidateUserCache(yubikeyUser.id);
		const secretKey = btoa("01234567890123456789");
		const configured = await request("/api/yubico-control/config", {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				clientId: "12345",
				secretKey,
			}),
		});
		assert.equal(configured.status, 200, await configured.clone().text());
		const stored = await testDatabase
			.prepare(
				"SELECT value FROM config WHERE key = 'security.yubico.credentials.v1'",
			)
			.first<{ value: string }>();
		assert.ok(stored?.value);
		assert.doesNotMatch(stored.value, /12345|MDEyMzQ1Njc4/);
		const { db: rotatedJwtDb } = await createDatabase(testDatabase);
		try {
			assert.deepEqual(
				await loadYubicoCredentials(rotatedJwtDb, {
					...bindings,
					JWT_SECRET: "rotated-token-signing-secret-at-least-thirty-two-chars",
				}),
				{ clientId: "12345", secretKey },
			);
		} finally {
			await rotatedJwtDb.destroy();
		}

		const settings = await request("/api/yubico-enrollment/settings", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }),
		});
		assert.equal(settings.status, 200, await settings.clone().text());
		assert.deepEqual(
			await settings
				.json<any>()
				.then((body) => [body.configured, body.enabled, body.nfc]),
			[true, true, true],
		);

		const login = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(login.status, 400);
		const body = await login.json<any>();
		assert.ok(body.TwoFactorProviders.includes("3"));
		assert.equal(body.TwoFactorProviders2["3"].Nfc, true);
		await testDatabase
			.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?")
			.bind(JSON.stringify({ keys: [], nfc: false }), EMAIL)
			.run();
		if (yubikeyUser) invalidateUserCache(yubikeyUser.id);
	});

	test("deletes an account only after password verification and blocks organization owners", async () => {
		const ownerLogin = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(ownerLogin.status, 200, await ownerLogin.clone().text());
		const ownerToken = (await ownerLogin.json<{ access_token: string }>())
			.access_token;
		const blocked = await request("/api/accounts/delete", {
			method: "POST",
			headers: {
				authorization: `Bearer ${ownerToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }),
		});
		assert.equal(blocked.status, 409, await blocked.clone().text());

		const email = "delete-me@example.com";
		assert.equal(
			(
				await request("/api/accounts/register", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						email,
						name: "Delete Me",
						masterPasswordHash: MASTER_PASSWORD_HASH,
						key: "encrypted-delete-key",
						kdf: 0,
						kdfIterations: 600_000,
					}),
				})
			).status,
			204,
		);
		const login = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: email,
				password: MASTER_PASSWORD_HASH,
				deviceIdentifier: "delete-device",
				deviceName: "Delete Device",
				deviceType: "14",
			}),
		});
		const token = (await login.json<{ access_token: string }>()).access_token;
		const wrongPassword = await request("/api/accounts/delete", {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ masterPasswordHash: "wrong" }),
		});
		assert.equal(wrongPassword.status, 400);
		const deleted = await request("/api/accounts", {
			method: "DELETE",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }),
		});
		assert.equal(deleted.status, 204, await deleted.clone().text());
		assert.equal(
			await testDatabase
				.prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?")
				.bind(email)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			0,
		);
		assert.equal(
			(
				await request("/api/accounts/profile", {
					headers: { authorization: `Bearer ${token}` },
				})
			).status,
			401,
		);
	});

	test("requires password verification and invalidates every session when removing all devices", async () => {
		const login = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
				deviceIdentifier: "final-device",
				deviceName: "Final device",
				deviceType: "0",
			}),
		});
		assert.equal(login.status, 200, await login.clone().text());
		const token = (await login.json<{ access_token: string }>()).access_token;
		const removed = await request("/api/devices", {
			method: "DELETE",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }),
		});
		assert.equal(removed.status, 200, await removed.clone().text());
		assert.equal(
			(
				await request("/api/accounts/profile", {
					headers: { authorization: `Bearer ${token}` },
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
