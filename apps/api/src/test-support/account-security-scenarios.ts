import assert from "node:assert/strict";
import { test } from "vitest";
import { createDatabase } from "../middleware/db";
import { invalidateUserCache } from "../services/auth";
import { encryptCredential } from "../services/credential-protection";
import { runMaintenance } from "../services/maintenance";
import { loadYubicoCredentials } from "../services/yubico-config";

export interface AccountSecurityScenarioContext {
	readonly database: D1Database;
	readonly bindings: CloudflareBindings;
	memberAccessToken: string;
	request: (path: string, init?: RequestInit) => Promise<Response>;
	email: string;
	memberEmail: string;
	masterPasswordHash: string;
	dataEncryptionSecret: string;
}

export function registerAccountSecurityScenarios(
	context: AccountSecurityScenarioContext,
): void {
	const request = context.request;
	const EMAIL = context.email;
	const MEMBER_EMAIL = context.memberEmail;
	const MASTER_PASSWORD_HASH = context.masterPasswordHash;
	const DATA_ENCRYPTION_SECRET = context.dataEncryptionSecret;
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
		await context.database
			.prepare(
				"UPDATE users SET totp_secret = ?, totp_recovery_code = ? WHERE email = ?",
			)
			.bind(encryptedTotpSecret, encryptedRecoveryCode, EMAIL)
			.run();
		const recoveryUser = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		if (recoveryUser) invalidateUserCache(recoveryUser.id);
		const owner = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(owner?.id);
		const securityKeyId = crypto.randomUUID();
		const timestamp = Math.floor(Date.now() / 1000);
		await context.database
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
		const revisionBeforeRecovery = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(owner.id)
			.first<{ revision_date: number }>();
		assert.ok(revisionBeforeRecovery);

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
		const user = await context.database
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
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(owner.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			revisionBeforeRecovery.revision_date + 1,
		);
		assert.equal(
			await context.database
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
		const user = await context.database
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
			await context.database
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
		const auth = { authorization: `Bearer ${context.memberAccessToken}` };
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
		const revisionBeforeDelete = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.ok(revisionBeforeDelete);

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
		const revisionAfterDelete = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(user.id)
			.first<{ revision_date: number }>();
		assert.ok(revisionAfterDelete);
		assert.ok(
			revisionAfterDelete.revision_date > revisionBeforeDelete.revision_date,
		);
		assert.equal(
			await context.database
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
		await context.database
			.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?")
			.bind(JSON.stringify({ keys: ["ccccccbbbbbb"], nfc: true }), EMAIL)
			.run();
		const yubikeyUser = await context.database
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
		await context.database
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
		await context.database
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
		const stored = await context.database
			.prepare(
				"SELECT value FROM config WHERE key = 'security.yubico.credentials.v1'",
			)
			.first<{ value: string }>();
		assert.ok(stored?.value);
		assert.doesNotMatch(stored.value, /12345|MDEyMzQ1Njc4/);
		const { db: rotatedJwtDb } = await createDatabase(context.database);
		try {
			assert.deepEqual(
				await loadYubicoCredentials(rotatedJwtDb, {
					...context.bindings,
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
		await context.database
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
		const deletingUser = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(email)
			.first<{ id: string }>();
		assert.ok(deletingUser);
		const deletingCipherId = crypto.randomUUID();
		const deletingAttachmentId = crypto.randomUUID();
		const deletingAttachmentKey = `attachments/${deletingCipherId}/${deletingAttachmentId}.bin`;
		const timestamp = Math.floor(Date.now() / 1000);
		await context.database.batch([
			context.database
				.prepare(
					"INSERT INTO ciphers (id,user_id,type,name,favorite,data,reprompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					deletingCipherId,
					deletingUser.id,
					1,
					"encrypted-delete-cipher",
					0,
					"{}",
					0,
					timestamp,
					timestamp,
				),
			context.database
				.prepare(
					"INSERT INTO attachments (id,cipher_id,file_name,size,size_name,storage_key,created_at) VALUES (?,?,?,?,?,?,?)",
				)
				.bind(
					deletingAttachmentId,
					deletingCipherId,
					"encrypted-delete-file",
					1,
					"1 Byte",
					deletingAttachmentKey,
					timestamp,
				),
		]);
		const r2 = context.bindings.ATTACHMENTS_R2 as R2Bucket;
		await r2.put(deletingAttachmentKey, new Uint8Array([1]));
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
		const tombstone = await context.database
			.prepare(
				"SELECT status, deletion_requested_at FROM users WHERE email = ?",
			)
			.bind(email)
			.first<{ status: string; deletion_requested_at: number | null }>();
		assert.equal(tombstone?.status, "banned");
		assert.ok(tombstone?.deletion_requested_at);
		assert.equal(
			(
				await request("/api/accounts/profile", {
					headers: { authorization: `Bearer ${token}` },
				})
			).status,
			401,
		);
		const originalDelete = r2.delete.bind(r2);
		r2.delete = async (key: string | string[]) => {
			const keys = Array.isArray(key) ? key : [key];
			if (keys.includes(deletingAttachmentKey)) {
				throw new Error("simulated account-deletion R2 outage");
			}
			await originalDelete(key);
		};
		const { db } = await createDatabase(context.database);
		try {
			const deferred = await runMaintenance(
				db,
				context.bindings,
				Math.floor(Date.now() / 1000) + 1,
			);
			assert.equal(deferred.purgedUsers, 0);
			assert.ok(
				await context.database
					.prepare("SELECT 1 FROM users WHERE id = ?")
					.bind(deletingUser.id)
					.first(),
			);
			r2.delete = originalDelete;
			const recovered = await runMaintenance(
				db,
				context.bindings,
				Math.floor(Date.now() / 1000) + 2,
			);
			assert.ok(recovered.purgedUsers >= 1);
		} finally {
			r2.delete = originalDelete;
			await db.destroy();
		}
		assert.equal(
			await context.database
				.prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?")
				.bind(email)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			0,
		);
		assert.ok(
			await context.database
				.prepare(
					"SELECT 1 FROM audit_logs WHERE action = 'account.purged' AND target_type = 'user' AND target_id = ?",
				)
				.bind(deletingUser.id)
				.first(),
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
}
