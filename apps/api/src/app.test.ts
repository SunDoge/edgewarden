import assert from "node:assert/strict";
import { afterAll as after, beforeAll as before, describe, test } from "vitest";
import { createDatabase } from "./middleware/db";
import { invalidateUserCache } from "./services/auth";
import { importBackupArchiveBytes } from "./services/backup/import";
import { encryptCredential } from "./services/credential-protection";
import { executeBatch } from "./services/db/batch";
import { runMaintenance } from "./services/maintenance";
import { loadYubicoCredentials } from "./services/yubico-config";
import { registerAdminOrganizationScenarios } from "./test-support/admin-organization-scenarios";
import {
	type ApiTestHarness,
	createApiTestHarness,
} from "./test-support/api-harness";
import { registerAuthScenarios } from "./test-support/auth-scenarios";
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
