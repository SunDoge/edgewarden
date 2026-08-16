import assert from "node:assert/strict";

export interface BackupRestoreFixture {
	userId: string;
	cipherId: string;
	accessToken: string;
	refreshToken: string;
}

export async function createBackupRestoreFixture(options: {
	database: D1Database;
	request: (path: string, init?: RequestInit) => Promise<Response>;
	masterPasswordHash: string;
}): Promise<BackupRestoreFixture> {
	const userId = crypto.randomUUID();
	const cipherId = crypto.randomUUID();
	const email = `backup-restore-${userId}@example.com`;
	const timestamp = Math.floor(Date.now() / 1000);
	await options.database
		.prepare(
			"INSERT INTO users (id,email,master_password_hash,key,kdf_type,kdf_iterations,security_stamp,verify_devices,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
		)
		.bind(
			userId,
			email,
			options.masterPasswordHash,
			"encrypted-backup-fixture-key",
			0,
			600_000,
			crypto.randomUUID(),
			0,
			timestamp,
			timestamp,
		)
		.run();
	await options.database
		.prepare(
			"INSERT INTO ciphers (id,user_id,type,name,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
		)
		.bind(
			cipherId,
			userId,
			1,
			"encrypted-backup-fixture-cipher",
			JSON.stringify({
				login: {
					username: "encrypted-user",
					password: "encrypted-password",
				},
			}),
			timestamp,
			timestamp,
		)
		.run();

	const login = await options.request("/identity/connect/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "password",
			username: email,
			password: options.masterPasswordHash,
			deviceIdentifier: `backup-restore-${userId}`,
			deviceName: "Backup Restore Test",
			deviceType: "0",
		}),
	});
	assert.equal(login.status, 200, await login.clone().text());
	const tokens = await login.json<{
		access_token: string;
		refresh_token: string;
	}>();
	return {
		userId,
		cipherId,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
	};
}
