import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { test } from "vitest";
import {
	MAX_AUDIT_METADATA_BYTES,
	MAX_AUDIT_METADATA_STRING_BYTES,
} from "../services/audit";
import { invalidateUserCache } from "../services/auth";
import { hashCredential } from "../services/credential-protection";

export interface VaultScenarioContext {
	readonly database: D1Database;
	readonly accessToken: string;
	readonly memberAccessToken: string;
	readonly r2Values: Map<string, Uint8Array>;
	cipherId: string;
	request: (
		path: string,
		init?: RequestInit,
		executionContext?: ExecutionContext,
	) => Promise<Response>;
	email: string;
	masterPasswordHash: string;
}

export function registerVaultScenarios(context: VaultScenarioContext): void {
	const request = context.request;
	const EMAIL = context.email;
	const MASTER_PASSWORD_HASH = context.masterPasswordHash;
	test("creates a folder and cipher through authenticated batch-backed handlers", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
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
		context.cipherId = cipher.id;
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
			profile: Record<string, unknown>;
			folders: Array<Record<string, unknown>>;
			ciphers: unknown[];
			policiesNew: unknown[];
			userDecryption: Record<string, unknown>;
		}>();
		assert.equal(syncBody.folders.length, 1);
		assert.equal(syncBody.ciphers.length, 1);
		assert.equal(typeof syncBody.profile.creationDate, "string");
		assert.equal(syncBody.profile.verifyDevices, false);
		assert.ok("accountKeys" in syncBody.profile);
		assert.deepEqual(
			syncBody.profile.organizationsNew,
			syncBody.profile.organizations,
		);
		assert.equal(typeof syncBody.folders[0].creationDate, "string");
		assert.deepEqual(syncBody.policiesNew, []);
		assert.ok(syncBody.userDecryption.masterPasswordUnlock);

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

	test("commits follow-up work only for the winning concurrent Cipher update", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
		const user = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);
		const current = await request(`/api/ciphers/${context.cipherId}`, {
			headers: auth,
		});
		assert.equal(current.status, 200, await current.clone().text());
		const cipher = await current.json<{
			revisionDate: string;
			folderId: string | null;
			fields: Array<{ name: string; value: string; type?: number }>;
		}>();
		const beforeRevision = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.ok(beforeRevision);

		const responses = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				request(`/api/ciphers/${context.cipherId}`, {
					method: "PUT",
					headers: { ...auth, "content-type": "application/json" },
					body: JSON.stringify({
						type: 1,
						name: `concurrent-encrypted-${index}`,
						folderId: cipher.folderId,
						fields: cipher.fields,
						login: {
							username: "encrypted-user",
							password: `encrypted-password-${index}`,
						},
						lastKnownRevisionDate: cipher.revisionDate,
					}),
				}),
			),
		);
		assert.equal(
			responses.filter((response) => response.status === 200).length,
			1,
		);
		assert.equal(
			responses.filter((response) => response.status === 409).length,
			7,
		);
		const afterRevision = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.equal(
			afterRevision?.revision_date,
			beforeRevision.revision_date + 1,
		);
	});

	test("fences concurrent permanent Cipher deletion", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const user = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);
		const createCipher = async (name: string) => {
			const response = await request("/api/ciphers", {
				method: "POST",
				headers: auth,
				body: JSON.stringify({
					type: 1,
					name,
					login: {
						username: "encrypted-user",
						password: "encrypted-password",
					},
				}),
			});
			assert.equal(response.status, 200, await response.clone().text());
			return (await response.json<{ id: string }>()).id;
		};
		const revision = async () => {
			const row = await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(user.id)
				.first<{ revision_date: number }>();
			assert.ok(row);
			return row.revision_date;
		};

		const singleId = await createCipher("concurrent-permanent-single");
		const beforeSingle = await revision();
		const singleResponses = await Promise.all(
			Array.from({ length: 4 }, () =>
				request(`/api/ciphers/${singleId}`, {
					method: "DELETE",
					headers: auth,
				}),
			),
		);
		assert.equal(
			singleResponses.filter((response) => response.status === 200).length,
			1,
		);
		assert.ok(
			singleResponses.every((response) =>
				[200, 404, 409].includes(response.status),
			),
		);
		assert.equal(await revision(), beforeSingle + 1);
		assert.equal(
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'cipher.delete.permanent' AND target_id = ?",
				)
				.bind(singleId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);

		const bulkId = await createCipher("concurrent-permanent-bulk");
		const beforeBulk = await revision();
		const beforeBulkAudit = await context.database
			.prepare(
				"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'cipher.delete.permanent.bulk'",
			)
			.first<{ count: number }>()
			.then((row) => Number(row?.count));
		const bulkDelete = () =>
			request("/api/ciphers/delete-permanent", {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ ids: [bulkId] }),
			});
		const bulkResponses = await Promise.all([
			bulkDelete(),
			bulkDelete(),
			bulkDelete(),
			bulkDelete(),
		]);
		assert.ok(bulkResponses.every((response) => response.status === 200));
		assert.equal(await revision(), beforeBulk + 1);
		assert.equal(
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'cipher.delete.permanent.bulk'",
				)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			beforeBulkAudit + 1,
		);
	});

	test("rolls back Cipher deletion when its audit tombstone cannot be written", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const created = await request("/api/ciphers", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				type: 1,
				name: "atomic-delete-audit",
				login: {
					username: "encrypted-user",
					password: "encrypted-password",
				},
			}),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const cipherId = (await created.json<{ id: string }>()).id;

		await context.database
			.prepare(`
				CREATE TRIGGER test_fail_atomic_delete_audit
				BEFORE INSERT ON audit_logs
				WHEN NEW.action = 'cipher.delete'
				BEGIN
					SELECT RAISE(ABORT, 'simulated audit outage');
				END
			`)
			.run();
		try {
			const failed = await request(`/api/ciphers/${cipherId}/delete`, {
				method: "PUT",
				headers: auth,
			});
			assert.equal(failed.status, 500);
			const cipher = await context.database
				.prepare("SELECT deleted_at FROM ciphers WHERE id = ?")
				.bind(cipherId)
				.first<{ deleted_at: number | null }>();
			assert.equal(cipher?.deleted_at, null);
			assert.equal(
				await context.database
					.prepare(
						"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'cipher.delete' AND target_id = ?",
					)
					.bind(cipherId)
					.first<{ count: number }>()
					.then((row) => Number(row?.count)),
				0,
			);
		} finally {
			await context.database
				.prepare("DROP TRIGGER IF EXISTS test_fail_atomic_delete_audit")
				.run();
		}

		const deleted = await request(`/api/ciphers/${cipherId}/delete`, {
			method: "PUT",
			headers: auth,
		});
		assert.equal(deleted.status, 200, await deleted.clone().text());
		assert.ok(
			await context.database
				.prepare(
					"SELECT 1 FROM audit_logs WHERE action = 'cipher.delete' AND target_id = ? AND is_tombstone = 1",
				)
				.bind(cipherId)
				.first(),
		);
	});

	test("bounds untrusted request metadata without blocking Cipher deletion", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const created = await request("/api/ciphers", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				type: 1,
				name: "bounded-delete-audit",
				login: {
					username: "encrypted-user",
					password: "encrypted-password",
				},
			}),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const cipherId = (await created.json<{ id: string }>()).id;
		const deleted = await request(`/api/ciphers/${cipherId}/delete`, {
			method: "PUT",
			headers: {
				...auth,
				"user-agent": "oversized-user-agent/".repeat(1000),
			},
		});
		assert.equal(deleted.status, 200, await deleted.clone().text());
		const audit = await context.database
			.prepare(
				"SELECT metadata FROM audit_logs WHERE action = 'cipher.delete' AND target_id = ?",
			)
			.bind(cipherId)
			.first<{ metadata: string }>();
		assert.ok(audit);
		assert.ok(
			new TextEncoder().encode(audit.metadata).byteLength <=
				MAX_AUDIT_METADATA_BYTES,
		);
		const metadata = JSON.parse(audit.metadata) as { userAgent: string };
		assert.ok(
			new TextEncoder().encode(metadata.userAgent).byteLength <=
				MAX_AUDIT_METADATA_STRING_BYTES,
		);
		assert.equal(metadata.userAgent.includes("�"), false);
	});

	test("makes bulk Cipher lifecycle transitions idempotent", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const user = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);
		const created = await request("/api/ciphers", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				type: 1,
				name: "idempotent-lifecycle-cipher",
				login: {
					username: "encrypted-user",
					password: "encrypted-password",
				},
			}),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const cipherId = (await created.json<{ id: string }>()).id;
		const revision = async () => {
			const row = await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(user.id)
				.first<{ revision_date: number }>();
			assert.ok(row);
			return row.revision_date;
		};
		const runRepeated = async (
			path: string,
			body: Record<string, unknown>,
			method = "POST",
		) => {
			const before = await revision();
			const mutate = () =>
				request(path, {
					method,
					headers: auth,
					body: JSON.stringify(body),
				});
			const responses = await Promise.all([
				mutate(),
				mutate(),
				mutate(),
				mutate(),
			]);
			assert.ok(
				responses.every((response) => response.status === 200),
				(await responses.find((response) => response.status !== 200)?.text()) ??
					"Cipher lifecycle request failed",
			);
			assert.equal(await revision(), before + 1);
		};

		await runRepeated("/api/ciphers/delete", { ids: [cipherId] }, "PUT");
		assert.ok(
			await context.database
				.prepare("SELECT deleted_at FROM ciphers WHERE id = ?")
				.bind(cipherId)
				.first<{ deleted_at: number | null }>()
				.then((row) => row?.deleted_at),
		);
		await runRepeated("/api/ciphers/restore", { ids: [cipherId] });
		assert.equal(
			await context.database
				.prepare("SELECT deleted_at FROM ciphers WHERE id = ?")
				.bind(cipherId)
				.first<{ deleted_at: number | null }>()
				.then((row) => row?.deleted_at),
			null,
		);
		await runRepeated("/api/ciphers/archive", { ids: [cipherId] });
		assert.ok(
			await context.database
				.prepare("SELECT archived_at FROM ciphers WHERE id = ?")
				.bind(cipherId)
				.first<{ archived_at: number | null }>()
				.then((row) => row?.archived_at),
		);
		await runRepeated("/api/ciphers/unarchive", { ids: [cipherId] });

		const folder = await request("/api/folders", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ name: "encrypted-lifecycle-folder" }),
		});
		assert.equal(folder.status, 200, await folder.clone().text());
		const folderId = (await folder.json<{ id: string }>()).id;
		await runRepeated("/api/ciphers/move", {
			ids: [cipherId],
			folderId,
		});
		assert.equal(
			await context.database
				.prepare("SELECT folder_id FROM ciphers WHERE id = ?")
				.bind(cipherId)
				.first<{ folder_id: string | null }>()
				.then((row) => row?.folder_id),
			folderId,
		);
	});

	test("syncs a vault larger than D1's bound-parameter limit", async () => {
		const user = await context.database
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
			context.database
				.prepare(
					"INSERT INTO ciphers (id, user_id, type, name, data, favorite, reprompt, created_at, updated_at) VALUES (?, ?, 1, ?, '{}', 0, 0, ?, ?)",
				)
				.bind(id, user.id, `encrypted-${id}`, timestamp, timestamp),
		);

		try {
			for (let index = 0; index < statements.length; index += 50) {
				await context.database.batch(statements.slice(index, index + 50));
			}
			const response = await request("/api/sync", {
				headers: { authorization: `Bearer ${context.accessToken}` },
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
					authorization: `Bearer ${context.accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ ids: cipherIds }),
			});
			assert.equal(bulkResponse.status, 200, await bulkResponse.clone().text());
		} finally {
			await context.database
				.prepare("DELETE FROM ciphers WHERE id LIKE 'large-sync-%'")
				.run();
		}
	});

	test("rolls back a cipher update when its revision write fails", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
		const beforeResponse = await request(`/api/ciphers/${context.cipherId}`, {
			headers: auth,
		});
		assert.equal(beforeResponse.status, 200);
		const before = await beforeResponse.json<{
			name: string;
			revisionDate: string;
		}>();
		await context.database
			.prepare(`
				CREATE TRIGGER test_fail_cipher_revision
				BEFORE UPDATE ON user_revisions
				BEGIN
					SELECT RAISE(ABORT, 'forced revision failure');
				END
			`)
			.run();
		try {
			const response = await request(`/api/ciphers/${context.cipherId}`, {
				method: "PUT",
				headers: { ...auth, "content-type": "application/json" },
				body: JSON.stringify({
					type: 1,
					name: "must-not-be-committed",
					login: {
						username: "encrypted-user",
						password: "encrypted-new-password",
					},
					lastKnownRevisionDate: before.revisionDate,
				}),
			});
			assert.equal(response.status, 500, await response.clone().text());
		} finally {
			await context.database
				.prepare("DROP TRIGGER IF EXISTS test_fail_cipher_revision")
				.run();
		}

		const afterResponse = await request(`/api/ciphers/${context.cipherId}`, {
			headers: auth,
		});
		assert.equal(afterResponse.status, 200);
		const after = await afterResponse.json<{
			name: string;
			revisionDate: string;
		}>();
		assert.deepEqual(after, before);
	});

	test("stores auth request access codes as protected credentials", async () => {
		const accessCode = "auth-request-client-secret";
		const response = await request("/api/auth-requests", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
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
		const stored = await context.database
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
		const rejected = await request(`/api/auth-requests/${body.id}`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ approved: false }),
		});
		assert.equal(rejected.status, 200, await rejected.clone().text());
		assert.equal(
			(await rejected.json<{ approved: boolean }>()).approved,
			false,
		);
		const reversed = await request(`/api/auth-requests/${body.id}`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ approved: true, key: "late-key" }),
		});
		assert.equal(reversed.status, 409, await reversed.clone().text());
		assert.equal(
			await context.database
				.prepare("SELECT approved FROM auth_requests WHERE id = ?")
				.bind(body.id)
				.first<{ approved: number }>()
				.then((row) => row?.approved),
			0,
		);
	});

	test("fails closed on malformed local account invariants", async () => {
		await assert.rejects(() =>
			context.database
				.prepare("UPDATE users SET email = ? WHERE email = ?")
				.bind(EMAIL.toUpperCase(), EMAIL)
				.run(),
		);
		await assert.rejects(() =>
			context.database
				.prepare(
					"UPDATE users SET kdf_type = 1, kdf_iterations = 2, kdf_memory = NULL, kdf_parallelism = NULL WHERE email = ?",
				)
				.bind(EMAIL)
				.run(),
		);
		await assert.rejects(() =>
			context.database
				.prepare("UPDATE users SET yubikey_config = '{}' WHERE email = ?")
				.bind(EMAIL)
				.run(),
		);
		await assert.rejects(() =>
			context.database
				.prepare("UPDATE users SET totp_secret = '{}' WHERE email = ?")
				.bind(EMAIL)
				.run(),
		);
	});

	test("rejects cross-user or missing folder ids at the database boundary", async () => {
		const response = await request("/api/ciphers", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
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

	test("imports into an owned existing folder without creating a duplicate", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const created = await request("/api/folders", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ name: "encrypted-import-target" }),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const folderId = (await created.json<{ id: string }>()).id;
		const before = await context.database
			.prepare(
				"SELECT COUNT(*) AS count FROM folders WHERE user_id = (SELECT id FROM users WHERE email = ?)",
			)
			.bind(EMAIL)
			.first<{ count: number }>();

		const imported = await request("/api/ciphers/import", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				folders: [{ id: folderId, name: "encrypted-import-target" }],
				ciphers: [{ type: 1, name: "encrypted-imported-item" }],
				folderRelationships: [{ key: 0, value: 0 }],
			}),
		});
		assert.equal(imported.status, 200, await imported.clone().text());
		const after = await context.database
			.prepare(
				"SELECT COUNT(*) AS count FROM folders WHERE user_id = (SELECT id FROM users WHERE email = ?)",
			)
			.bind(EMAIL)
			.first<{ count: number }>();
		assert.equal(after?.count, before?.count);
		assert.equal(
			await context.database
				.prepare("SELECT folder_id FROM ciphers WHERE name = ?")
				.bind("encrypted-imported-item")
				.first<{ folder_id: string }>()
				.then((row) => row?.folder_id),
			folderId,
		);
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
		const firstId = await createFolder(
			context.accessToken,
			"encrypted-bulk-one",
		);
		const secondId = await createFolder(
			context.accessToken,
			"encrypted-bulk-two",
		);
		const otherUserId = await createFolder(
			context.memberAccessToken,
			"encrypted-other-user",
		);
		await context.database
			.prepare("UPDATE ciphers SET folder_id = ? WHERE id = ?")
			.bind(firstId, context.cipherId)
			.run();

		const invalid = await request("/api/folders/delete", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ids: [] }),
		});
		assert.equal(invalid.status, 400);
		const deleted = await request("/api/folders/delete", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ids: [firstId, secondId, secondId, otherUserId] }),
		});
		assert.equal(deleted.status, 204, await deleted.clone().text());

		assert.deepEqual(
			await context.database
				.prepare("SELECT COUNT(*) AS count FROM folders WHERE id IN (?, ?)")
				.bind(firstId, secondId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			0,
		);
		assert.equal(
			await context.database
				.prepare("SELECT COUNT(*) AS count FROM folders WHERE id = ?")
				.bind(otherUserId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
		assert.equal(
			await context.database
				.prepare("SELECT folder_id FROM ciphers WHERE id = ?")
				.bind(context.cipherId)
				.first<{ folder_id: string | null }>()
				.then((row) => row?.folder_id),
			null,
		);
	});

	test("advances revision once for concurrent deletion of one folder", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const created = await request("/api/folders", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ name: "concurrent-delete-folder" }),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const folderId = (await created.json<{ id: string }>()).id;
		const user = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);
		const before = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.ok(before);

		const responses = await Promise.all([
			request(`/api/folders/${folderId}`, { method: "DELETE", headers: auth }),
			request(`/api/folders/${folderId}`, { method: "DELETE", headers: auth }),
		]);
		assert.ok(responses.some((response) => response.status === 200));
		assert.ok(
			responses.every((response) => [200, 404].includes(response.status)),
		);
		const after = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.equal(after?.revision_date, before.revision_date + 1);
	});

	test("fences concurrent Folder updates and rolls back failed revisions", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const created = await request("/api/folders", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ name: "folder-before-fenced-update" }),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const folderId = (await created.json<{ id: string }>()).id;
		const user = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);

		await context.database
			.prepare(`
				CREATE TRIGGER test_fail_folder_revision
				BEFORE UPDATE ON user_revisions
				BEGIN
					SELECT RAISE(ABORT, 'forced folder revision failure');
				END
			`)
			.run();
		try {
			const failed = await request(`/api/folders/${folderId}`, {
				method: "PUT",
				headers: auth,
				body: JSON.stringify({ name: "folder-must-not-commit" }),
			});
			assert.equal(failed.status, 500, await failed.clone().text());
		} finally {
			await context.database
				.prepare("DROP TRIGGER IF EXISTS test_fail_folder_revision")
				.run();
		}
		assert.deepEqual(
			await context.database
				.prepare("SELECT name, mutation_token FROM folders WHERE id = ?")
				.bind(folderId)
				.first<{ name: string; mutation_token: string | null }>(),
			{ name: "folder-before-fenced-update", mutation_token: null },
		);

		const beforeRevision = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.ok(beforeRevision);
		const responses = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				request(`/api/folders/${folderId}`, {
					method: "PUT",
					headers: auth,
					body: JSON.stringify({ name: `folder-concurrent-${index}` }),
				}),
			),
		);
		assert.equal(
			responses.filter((response) => response.status === 200).length,
			1,
		);
		assert.equal(
			responses.filter((response) => response.status === 409).length,
			7,
		);
		assert.equal(
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(user.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			beforeRevision.revision_date + 1,
		);
	});

	test("audits only folders actually removed by concurrent bulk deletion", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const created = await request("/api/folders", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ name: "concurrent-bulk-delete-folder" }),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const folderId = (await created.json<{ id: string }>()).id;
		const user = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);
		const beforeRevision = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.ok(beforeRevision);
		const beforeAudit = await context.database
			.prepare(
				"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'folder.delete.bulk'",
			)
			.first<{ count: number }>()
			.then((row) => Number(row?.count));
		const remove = () =>
			request("/api/folders/delete", {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ ids: [folderId] }),
			});
		const responses = await Promise.all([
			remove(),
			remove(),
			remove(),
			remove(),
		]);
		assert.ok(responses.every((response) => response.status === 204));
		assert.equal(
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(user.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			beforeRevision.revision_date + 1,
		);
		assert.equal(
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'folder.delete.bulk'",
				)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			beforeAudit + 1,
		);
	});

	test("fences concurrent account profile and key updates", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
		const original = await context.database
			.prepare(
				"SELECT id, name, master_password_hint, public_key, private_key FROM users WHERE email = ?",
			)
			.bind(EMAIL)
			.first<{
				id: string;
				name: string | null;
				master_password_hint: string | null;
				public_key: string | null;
				private_key: string | null;
			}>();
		assert.ok(original);
		try {
			const profiles = await Promise.all(
				Array.from({ length: 8 }, (_, index) =>
					request("/api/accounts/profile", {
						method: "PUT",
						headers: { ...auth, "content-type": "application/json" },
						body: JSON.stringify({
							name: `Concurrent profile ${index}`,
							masterPasswordHint: `hint-${index}`,
						}),
					}),
				),
			);
			assert.equal(
				profiles.filter((response) => response.status === 200).length,
				1,
			);
			assert.equal(
				profiles.filter((response) => response.status === 409).length,
				7,
			);

			await context.database
				.prepare(
					"UPDATE users SET name = ?, master_password_hint = ? WHERE id = ?",
				)
				.bind(original.name, original.master_password_hint, original.id)
				.run();
			invalidateUserCache(original.id);

			const keyUpdates = await Promise.all(
				Array.from({ length: 8 }, (_, index) =>
					request("/api/accounts/keys", {
						method: "POST",
						headers: { ...auth, "content-type": "application/json" },
						body: JSON.stringify({
							publicKey: `public-key-${index}`,
							encryptedPrivateKey: `private-key-${index}`,
						}),
					}),
				),
			);
			assert.equal(
				keyUpdates.filter((response) => response.status === 200).length,
				1,
			);
			assert.equal(
				keyUpdates.filter((response) => response.status === 409).length,
				7,
			);
		} finally {
			await context.database
				.prepare(
					"UPDATE users SET name = ?, master_password_hint = ?, public_key = ?, private_key = ? WHERE id = ?",
				)
				.bind(
					original.name,
					original.master_password_hint,
					original.public_key,
					original.private_key,
					original.id,
				)
				.run();
			invalidateUserCache(original.id);
		}
	});

	test("validates device updates and hides resources outside the user scope", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
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
		const rename = (index: number) =>
			request("/api/devices/api-test-device/name", {
				method: "PUT",
				headers: { ...auth, "content-type": "application/json" },
				body: JSON.stringify({ name: `Concurrent Device ${index}` }),
			});
		const renames = await Promise.all(
			Array.from({ length: 8 }, (_, index) => rename(index)),
		);
		assert.ok(renames.some((response) => response.status === 200));
		assert.ok(
			renames.every((response) => [200, 409].includes(response.status)),
		);

		const updateKeys = (index: number) =>
			request("/api/devices/api-test-device/keys", {
				method: "PUT",
				headers: { ...auth, "content-type": "application/json" },
				body: JSON.stringify({
					encryptedUserKey: `encrypted-user-key-${index}`,
					encryptedPublicKey: `encrypted-public-key-${index}`,
					encryptedPrivateKey: `encrypted-private-key-${index}`,
				}),
			});
		const keyUpdates = await Promise.all(
			Array.from({ length: 8 }, (_, index) => updateKeys(index)),
		);
		assert.ok(keyUpdates.some((response) => response.status === 200));
		assert.ok(
			keyUpdates.every((response) => [200, 409].includes(response.status)),
		);

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
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM devices WHERE device_identifier = 'member-test-device'",
				)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
	});

	test("atomically revokes every credential bound to a deleted device", async () => {
		const user = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);
		const deviceId = `revoked-device-${crypto.randomUUID()}`;
		const sessionStamp = crypto.randomUUID();
		const refreshToken = `refresh-${crypto.randomUUID()}`;
		const trustToken = `trust-${crypto.randomUUID()}`;
		const timestamp = Math.floor(Date.now() / 1000);
		await context.database.batch([
			context.database
				.prepare(
					"INSERT INTO devices (user_id,device_identifier,name,type,session_stamp,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
				)
				.bind(
					user.id,
					deviceId,
					"Revoked Device",
					14,
					sessionStamp,
					timestamp,
					timestamp,
				),
			context.database
				.prepare(
					"INSERT INTO refresh_tokens (token,user_id,expires_at,device_identifier,device_session_stamp) VALUES (?,?,?,?,?)",
				)
				.bind(refreshToken, user.id, timestamp + 3600, deviceId, sessionStamp),
			context.database
				.prepare(
					"INSERT INTO device_trust_tokens (token,user_id,device_identifier,expires_at) VALUES (?,?,?,?)",
				)
				.bind(trustToken, user.id, deviceId, timestamp + 3600),
		]);
		const remove = () =>
			request(`/api/devices/${deviceId}`, {
				method: "DELETE",
				headers: { authorization: `Bearer ${context.accessToken}` },
			});
		const responses = await Promise.all([
			remove(),
			remove(),
			remove(),
			remove(),
		]);
		assert.equal(
			responses.filter((response) => response.status === 200).length,
			1,
		);
		assert.ok(
			responses.every((response) => [200, 404].includes(response.status)),
		);
		for (const table of ["devices", "refresh_tokens", "device_trust_tokens"]) {
			assert.equal(
				await context.database
					.prepare(
						`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ? AND device_identifier = ?`,
					)
					.bind(user.id, deviceId)
					.first<{ count: number }>()
					.then((row) => Number(row?.count)),
				0,
			);
		}
	});

	test("validates domain settings before persistence", async () => {
		const response = await request("/api/settings/domains", {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ excludedGlobalEquivalentDomains: "invalid" }),
		});
		assert.equal(response.status, 400);
	});

	test("advances the vault revision with domain settings atomically", async () => {
		const user = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(user);
		const before = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.ok(before);
		const response = await request("/api/settings/domains", {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				customEquivalentDomains: [
					{
						type: 1,
						domains: ["example.com", "example.net"],
						excluded: false,
					},
				],
				excludedGlobalEquivalentDomains: [1],
			}),
		});
		assert.equal(response.status, 200, await response.clone().text());
		const after = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.equal(after?.revision_date, before.revision_date + 1);
	});

	test("uses cipher ownership middleware for soft-delete and restore", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
		const missing = await request(`/api/ciphers/${crypto.randomUUID()}`, {
			headers: auth,
		});
		assert.equal(missing.status, 404);

		const deleted = await request(`/api/ciphers/${context.cipherId}/delete`, {
			method: "PUT",
			headers: auth,
		});
		assert.equal(deleted.status, 200);
		const trashedCipher = await request(`/api/ciphers/${context.cipherId}`, {
			headers: auth,
		});
		assert.equal(trashedCipher.status, 200);
		assert.ok(
			(await trashedCipher.json<{ deletedDate: string | null }>()).deletedDate,
		);

		const restored = await request(`/api/ciphers/${context.cipherId}/restore`, {
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
		const auth = { authorization: `Bearer ${context.accessToken}` };
		const archived = await request(`/api/ciphers/${context.cipherId}/archive`, {
			method: "PUT",
			headers: auth,
		});
		assert.equal(archived.status, 200, await archived.clone().text());
		assert.ok(
			(await archived.json<{ archivedDate: string | null }>()).archivedDate,
		);

		const hidden = await request(`/api/ciphers/${context.cipherId}/archive`, {
			method: "PUT",
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(hidden.status, 404);

		const unarchived = await request("/api/ciphers/unarchive", {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ ids: [context.cipherId] }),
		});
		assert.equal(unarchived.status, 200, await unarchived.clone().text());
		const cipher = await request(`/api/ciphers/${context.cipherId}`, {
			headers: auth,
		});
		assert.equal(
			(await cipher.json<{ archivedDate: string | null }>()).archivedDate,
			null,
		);

		const bulkArchived = await request("/api/ciphers/archive", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ ids: [context.cipherId] }),
		});
		assert.equal(bulkArchived.status, 200, await bulkArchived.clone().text());
		const restored = await request(
			`/api/ciphers/${context.cipherId}/unarchive`,
			{
				method: "POST",
				headers: auth,
			},
		);
		assert.equal(restored.status, 200, await restored.clone().text());
		assert.equal(
			(await restored.json<{ archivedDate: string | null }>()).archivedDate,
			null,
		);
	});

	test("matches Vaultwarden cipher and folder method compatibility semantics", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
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
					body: JSON.stringify({ ids: [context.cipherId], folderId }),
				})
			).status,
			200,
		);
		assert.equal(
			(
				await (
					await request(`/api/ciphers/${context.cipherId}`, { headers: auth })
				).json<{ folderId: string | null }>()
			).folderId,
			folderId,
		);
		assert.equal(
			(
				await request("/api/ciphers/move", {
					method: "POST",
					headers: auth,
					body: JSON.stringify({ ids: [context.cipherId], folderId: null }),
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
		const auth = { authorization: `Bearer ${context.accessToken}` };
		const encryptedBytes = new TextEncoder().encode(
			"encrypted-attachment-payload",
		);
		const created = await request(
			`/api/ciphers/${context.cipherId}/attachment/v2`,
			{
				method: "POST",
				headers: { ...auth, "content-type": "application/json" },
				body: JSON.stringify({
					fileName: "2.encrypted-file-name",
					key: "2.encrypted-attachment-key",
					fileSize: encryptedBytes.byteLength,
				}),
			},
		);
		assert.equal(created.status, 200, await created.clone().text());
		const metadata = await created.json<{
			attachmentId: string;
			url: string;
		}>();
		const beforeUpload = await request(`/api/ciphers/${context.cipherId}`, {
			headers: auth,
		});
		assert.equal(beforeUpload.status, 200);
		assert.equal(
			(
				await beforeUpload.json<{
					attachments: Array<{ id: string }>;
				}>()
			).attachments.some((item) => item.id === metadata.attachmentId),
			false,
		);

		const crossUser = await request(
			`/api/ciphers/${context.cipherId}/attachment/${metadata.attachmentId}`,
			{
				headers: { authorization: `Bearer ${context.memberAccessToken}` },
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
		assert.equal(replay.status, 201);

		const downloaded = await request(
			`/api/ciphers/${context.cipherId}/attachment/${metadata.attachmentId}`,
			{ headers: auth },
		);
		assert.equal(downloaded.status, 200, await downloaded.clone().text());
		assert.deepEqual(
			new Uint8Array(await downloaded.arrayBuffer()),
			encryptedBytes,
		);
		assert.equal(downloaded.headers.get("cache-control"), "private, no-store");

		const cipher = await request(`/api/ciphers/${context.cipherId}`, {
			headers: auth,
		});
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
			backupFiles[
				`attachments/${context.cipherId}/${metadata.attachmentId}.bin`
			],
			encryptedBytes,
		);
		const manifest = JSON.parse(
			new TextDecoder().decode(backupFiles["manifest.json"]),
		) as { storageKind: string; blobSummary: { attachmentFiles: number } };
		assert.equal(manifest.storageKind, "r2");
		assert.equal(manifest.blobSummary.attachmentFiles, 1);
		assert.ok(
			await context.database
				.prepare(
					"SELECT 1 FROM audit_logs WHERE action = 'backup.exported' AND target_type = 'backup' ORDER BY created_at DESC LIMIT 1",
				)
				.first(),
		);

		const removed = await request(
			`/api/ciphers/${context.cipherId}/attachment/${metadata.attachmentId}/delete`,
			{ method: "POST", headers: auth },
		);
		assert.equal(removed.status, 204, await removed.clone().text());
		const gone = await request(
			`/api/ciphers/${context.cipherId}/attachment/${metadata.attachmentId}`,
			{ headers: auth },
		);
		assert.equal(gone.status, 404);
		const tombstone = await context.database
			.prepare("SELECT deleted_at, storage_key FROM attachments WHERE id = ?")
			.bind(metadata.attachmentId)
			.first<{ deleted_at: number | null; storage_key: string | null }>();
		assert.ok(tombstone?.deleted_at);
		assert.ok(tombstone?.storage_key);
		assert.equal(context.r2Values.has(tombstone.storage_key), true);
	});

	test("retries attachment publication after a D1 failure", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
		const encryptedBytes = new TextEncoder().encode("retryable-encrypted-blob");
		const created = await request(
			`/api/ciphers/${context.cipherId}/attachment/v2`,
			{
				method: "POST",
				headers: { ...auth, "content-type": "application/json" },
				body: JSON.stringify({
					fileName: "2.retry-name",
					key: "2.retry-key",
					fileSize: encryptedBytes.byteLength,
				}),
			},
		);
		assert.equal(created.status, 200, await created.clone().text());
		const metadata = await created.json<{
			attachmentId: string;
			url: string;
		}>();
		const uploadUrl = new URL(metadata.url);
		const upload = () =>
			request(`${uploadUrl.pathname}${uploadUrl.search}`, {
				method: "PUT",
				headers: {
					"content-type": "application/octet-stream",
					"content-length": String(encryptedBytes.byteLength),
				},
				body: encryptedBytes,
			});

		await context.database
			.prepare(`
				CREATE TRIGGER test_fail_attachment_publish
				BEFORE INSERT ON attachments
				BEGIN
					SELECT RAISE(ABORT, 'forced attachment publication failure');
				END
			`)
			.run();
		try {
			const failed = await upload();
			assert.equal(failed.status, 500, await failed.clone().text());
		} finally {
			await context.database
				.prepare("DROP TRIGGER IF EXISTS test_fail_attachment_publish")
				.run();
		}
		assert.equal(
			await context.database
				.prepare("SELECT 1 FROM attachments WHERE id = ?")
				.bind(metadata.attachmentId)
				.first()
				.then(Boolean),
			false,
		);
		const failedCandidate = await context.database
			.prepare(
				"SELECT object_key FROM blob_gc_queue WHERE instr(object_key, ?) = 1 ORDER BY created_at DESC LIMIT 1",
			)
			.bind(`attachments/${context.cipherId}/${metadata.attachmentId}.`)
			.first<{ object_key: string }>();
		assert.ok(failedCandidate?.object_key);
		assert.equal(context.r2Values.has(failedCandidate.object_key), true);

		const retried = await upload();
		assert.equal(retried.status, 201, await retried.clone().text());
		assert.equal(
			await context.database
				.prepare("SELECT 1 FROM attachments WHERE id = ?")
				.bind(metadata.attachmentId)
				.first()
				.then(Boolean),
			true,
		);
		const publishedStorageKey = await context.database
			.prepare("SELECT storage_key FROM attachments WHERE id = ?")
			.bind(metadata.attachmentId)
			.first<{ storage_key: string }>()
			.then((row) => row?.storage_key);
		assert.ok(publishedStorageKey);
		assert.notEqual(publishedStorageKey, failedCandidate.object_key);
		const downloaded = await request(
			`/api/ciphers/${context.cipherId}/attachment/${metadata.attachmentId}`,
			{ headers: auth },
		);
		assert.deepEqual(
			new Uint8Array(await downloaded.arrayBuffer()),
			encryptedBytes,
		);
		await request(
			`/api/ciphers/${context.cipherId}/attachment/${metadata.attachmentId}/delete`,
			{ method: "POST", headers: auth },
		);
	});
}
