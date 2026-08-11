import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { Miniflare } from "miniflare";
import { app } from "./index";
import { createDatabase } from "./middleware/db";
import { executeBatch } from "./services/db/batch";

const JWT_SECRET = "test-secret-that-is-at-least-thirty-two-characters";
const EMAIL = "api-test@example.com";
const MASTER_PASSWORD_HASH = "client-side-master-password-hash";
const MEMBER_EMAIL = "member-api-test@example.com";

let miniflare: Miniflare;
let bindings: CloudflareBindings;
let testDatabase: D1Database;
let accessToken = "";
let refreshToken = "";
let cipherId = "";
let sendId = "";
let sendAccessId = "";
let memberAccessToken = "";

async function request(path: string, init: RequestInit = {}) {
	return app.request(path, init, bindings);
}

before(async () => {
	miniflare = new Miniflare({
		workers: [
			{
				config: {
					name: "edgewarden-test",
					type: "worker",
					compatibilityDate: "2026-08-04",
					manifest: {
						mainModule: "index.js",
						modules: {
							"index.js": {
								type: "esm",
								contents:
									"export default { fetch() { return new Response('ok') } }",
							},
						},
					},
					env: {
						DB: { type: "d1", name: "DB" },
						ATTACHMENTS_KV: { type: "kv" },
					},
				},
			},
		],
	});
	const db = await miniflare.getD1Database("DB");
	testDatabase = db;
	const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
	const migrationStatements = readdirSync(migrationsDirectory).filter((file) => /^\d+.*\.sql$/.test(file)).sort().map((file) => readFileSync(resolve(migrationsDirectory, file), "utf8")).join("\n")
		.replace(/--.*$/gm, "")
		.split(";")
		.map((statement) => statement.trim())
		.filter(
			(statement) => statement && !statement.startsWith("PRAGMA foreign_keys"),
		);
	for (const [index, statement] of migrationStatements.entries()) {
		try {
			await db.prepare(statement).run();
		} catch (error) {
			throw new Error(`Migration statement ${index + 1} failed: ${statement}`, {
				cause: error,
			});
		}
	}
	const rateLimiter = { limit: async () => ({ success: true }) };
	bindings = {
		DB: db,
		ATTACHMENTS_KV: await miniflare.getKVNamespace("ATTACHMENTS_KV"),
		JWT_SECRET,
		RL_IP: rateLimiter,
		RL_ACCOUNT: rateLimiter,
	} as unknown as CloudflareBindings;
});

after(async () => {
	await miniflare.dispose();
});

describe("Edgewarden API", () => {
	test("advertises same-origin Fill Assist compatibility", async () => {
		const response = await request("https://vault.example.test/config");
		assert.equal(response.status, 200);
		const body = await response.json<{
			environment: { fillAssistRules: string };
			featureStates: Record<string, boolean>;
		}>();
		assert.equal(body.environment.fillAssistRules, "https://vault.example.test/fill-assist/");
		assert.equal(body.featureStates["fill-assist-targeting-rules"], true);
	});

	test("serves the empty Fill Assist ruleset with public caching", async () => {
		const manifest = await request("/fill-assist/manifest.json");
		assert.equal(manifest.status, 200);
		assert.equal(manifest.headers.get("cache-control"), "public, max-age=3600");
		const manifestBody = await manifest.json<{ maps: { forms: { v1: { filename: string; schema: string } } } }>();
		assert.equal(manifestBody.maps.forms.v1.filename, "forms.v1.json");

		for (const filename of [manifestBody.maps.forms.v1.filename, manifestBody.maps.forms.v1.schema]) {
			const response = await request(`/fill-assist/${filename}`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
		}
		assert.equal((await request("/fill-assist/unknown.json")).status, 404);
		assert.deepEqual(await (await request("/.well-known/assetlinks/check")).json(), {
			linked: false,
			maxAge: "86400s",
			debugString: "No matching digital asset link policy is configured for this server.",
		});
	});

	test("serves a local safe icon for invalid or private hosts", async () => {
		for (const host of ["localhost", "127.0.0.1", "internal.local"]) {
			const response = await request(`/icons/${host}/icon.png`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("content-type"), "image/svg+xml");
			assert.match(response.headers.get("cache-control") ?? "", /public/);
		}
	});

	test("rejects invalid registration payloads through Valibot", async () => {
		const response = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "not-an-email" }),
		});
		assert.equal(response.status, 400);
	});

	test("registers, logs in and returns the generated KDF settings", async () => {
		const registration = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: EMAIL,
				name: "API Test",
				masterPasswordHash: MASTER_PASSWORD_HASH,
				key: "encrypted-user-key",
				kdf: 0,
				kdfIterations: 600_000,
			}),
		});
		assert.equal(registration.status, 204);

		const prelogin = await request("/identity/accounts/prelogin", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: EMAIL }),
		});
		assert.equal(prelogin.status, 200);
		assert.deepEqual(
			await prelogin
				.json<{ kdf: number; kdfIterations: number }>()
				.then((body) => [body.kdf, body.kdfIterations]),
			[0, 600_000],
		);

		const passwordPrelogin = await request(
			"/identity/accounts/prelogin/password",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: EMAIL }),
			},
		);
		assert.equal(passwordPrelogin.status, 200);
		assert.deepEqual(
			await passwordPrelogin
				.json<{ kdf: number; kdfIterations: number }>()
				.then((body) => [body.kdf, body.kdfIterations]),
			[0, 600_000],
		);

		const form = new URLSearchParams({
			grant_type: "password",
			username: EMAIL,
			password: MASTER_PASSWORD_HASH,
			deviceIdentifier: "api-test-device",
			deviceName: "API Test Device",
			deviceType: "0",
		});
		const login = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: form,
		});
		assert.equal(login.status, 200, await login.clone().text());
		const tokenBody = await login.json<{
			token_type: string;
			access_token: string;
			refresh_token: string;
		}>();
		assert.equal(tokenBody.token_type, "Bearer");
		accessToken = tokenBody.access_token;
		refreshToken = tokenBody.refresh_token;
	});

	test("registers a non-admin account for authorization tests", async () => {
		const registration = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: MEMBER_EMAIL,
				name: "Member Test",
				masterPasswordHash: MASTER_PASSWORD_HASH,
				key: "encrypted-member-key",
				kdf: 0,
				kdfIterations: 600_000,
			}),
		});
		assert.equal(registration.status, 204);

		const login = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: MEMBER_EMAIL,
				password: MASTER_PASSWORD_HASH,
				deviceIdentifier: "member-test-device",
				deviceName: "Member Test Device",
				deviceType: "0",
			}),
		});
		assert.equal(login.status, 200, await login.clone().text());
		memberAccessToken = (await login.json<{ access_token: string }>())
			.access_token;
	});

	test("rotates refresh tokens and rejects replay", async () => {
		const previousRefreshToken = refreshToken;
		const rotated = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: previousRefreshToken,
			}),
		});
		assert.equal(rotated.status, 200, await rotated.clone().text());
		const tokens = await rotated.json<{
			access_token: string;
			refresh_token: string;
		}>();
		accessToken = tokens.access_token;
		refreshToken = tokens.refresh_token;
		assert.notEqual(refreshToken, previousRefreshToken);

		const replay = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: previousRefreshToken,
			}),
		});
		assert.equal(replay.status, 400);
	});

	test("issues dedicated realtime tickets and rejects invalid websocket tickets", async () => {
		(bindings as any).REALTIME = { getByName: () => ({ fetch: async () => new Response(null) }) };
		try {
			const ticketResponse = await request("/api/notifications/token", {
				method: "POST",
				headers: { authorization: `Bearer ${accessToken}` },
			});
			assert.equal(ticketResponse.status, 200, await ticketResponse.clone().text());
			const ticket = await ticketResponse.json<{ token: string; expiresIn: number; object: string }>();
			assert.equal(typeof ticket.token, "string");
			assert.deepEqual([ticket.expiresIn, ticket.object], [60, "realtimeTicket"]);

			const invalid = await request("/api/notifications/hub?ticket=invalid", {
				headers: { Upgrade: "websocket" },
			});
			assert.equal(invalid.status, 401);
		} finally {
			delete (bindings as any).REALTIME;
		}
	});

	test("creates a folder and cipher through authenticated batch-backed handlers", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const profileAlias = await request("/api/accounts/profile", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "API Test", masterPasswordHint: null }) });
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
		}>();
		cipherId = cipher.id;
		assert.equal(cipher.folderId, folder.id);
		assert.equal(cipher.favorite, true);
		assert.equal(cipher.fields.length, 1);
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
			const response = await request("/api/folders", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name }) });
			assert.equal(response.status, 200, await response.clone().text());
			return (await response.json<{ id: string }>()).id;
		};
		const firstId = await createFolder(accessToken, "encrypted-bulk-one");
		const secondId = await createFolder(accessToken, "encrypted-bulk-two");
		const otherUserId = await createFolder(memberAccessToken, "encrypted-other-user");
		await testDatabase.prepare("UPDATE ciphers SET folder_id = ? WHERE id = ?").bind(firstId, cipherId).run();

		const invalid = await request("/api/folders/delete", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ ids: [] }) });
		assert.equal(invalid.status, 400);
		const deleted = await request("/api/folders/delete", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ ids: [firstId, secondId, secondId, otherUserId] }) });
		assert.equal(deleted.status, 204, await deleted.clone().text());

		assert.equal(await testDatabase.prepare("SELECT COUNT(*) AS count FROM folders WHERE id IN (?, ?)").bind(firstId, secondId).first<{ count: number }>().then((row) => Number(row?.count)), 0);
		assert.equal(await testDatabase.prepare("SELECT COUNT(*) AS count FROM folders WHERE id = ?").bind(otherUserId).first<{ count: number }>().then((row) => Number(row?.count)), 1);
		assert.equal(await testDatabase.prepare("SELECT folder_id FROM ciphers WHERE id = ?").bind(cipherId).first<{ folder_id: string | null }>().then((row) => row?.folder_id), null);
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

		const unverifiedDeleteAll = await request("/api/devices", { method: "DELETE", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: "wrong-password" }) });
		assert.equal(unverifiedDeleteAll.status, 400);
		assert.equal((await request("/api/devices/api-test-device", { headers: auth })).status, 200);

		const secondaryLogin = await request("/identity/connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: EMAIL, password: MASTER_PASSWORD_HASH, deviceIdentifier: "secondary-device", deviceName: "Secondary", deviceType: "14" }) });
		assert.equal(secondaryLogin.status, 200, await secondaryLogin.clone().text());
		const secondaryToken = (await secondaryLogin.json<{ access_token: string }>()).access_token;
		const bulkRemoved = await request("/api/devices/delete", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ ids: ["secondary-device", "member-test-device"] }) });
		assert.equal(bulkRemoved.status, 200, await bulkRemoved.clone().text());
		assert.equal((await bulkRemoved.json<{ deleted: number }>()).deleted, 1);
		assert.equal((await request("/api/accounts/profile", { headers: { authorization: `Bearer ${secondaryToken}` } })).status, 401);
		assert.equal(await testDatabase.prepare("SELECT COUNT(*) AS count FROM devices WHERE device_identifier = 'member-test-device'").first<{ count: number }>().then((row) => Number(row?.count)), 1);
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
		const archived = await request(`/api/ciphers/${cipherId}/archive`, { method: "PUT", headers: auth });
		assert.equal(archived.status, 200, await archived.clone().text());
		assert.ok((await archived.json<{ archivedDate: string | null }>()).archivedDate);

		const hidden = await request(`/api/ciphers/${cipherId}/archive`, { method: "PUT", headers: { authorization: `Bearer ${memberAccessToken}` } });
		assert.equal(hidden.status, 404);

		const unarchived = await request("/api/ciphers/unarchive", {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ ids: [cipherId] }),
		});
		assert.equal(unarchived.status, 200, await unarchived.clone().text());
		const cipher = await request(`/api/ciphers/${cipherId}`, { headers: auth });
		assert.equal((await cipher.json<{ archivedDate: string | null }>()).archivedDate, null);

		const bulkArchived = await request("/api/ciphers/archive", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ ids: [cipherId] }),
		});
		assert.equal(bulkArchived.status, 200, await bulkArchived.clone().text());
		const restored = await request(`/api/ciphers/${cipherId}/unarchive`, { method: "POST", headers: auth });
		assert.equal(restored.status, 200, await restored.clone().text());
		assert.equal((await restored.json<{ archivedDate: string | null }>()).archivedDate, null);
	});

	test("matches Vaultwarden cipher and folder method compatibility semantics", async () => {
		const auth = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
		const folderResponse = await request("/api/folders", { method: "POST", headers: auth, body: JSON.stringify({ name: "encrypted-compat-folder" }) });
		const folderId = (await folderResponse.json<{ id: string }>()).id;
		assert.equal((await request(`/api/folders/${folderId}`, { method: "POST", headers: auth, body: JSON.stringify({ name: "encrypted-renamed-folder" }) })).status, 200);
		assert.equal((await request("/api/ciphers/move", { method: "PUT", headers: auth, body: JSON.stringify({ ids: [cipherId], folderId }) })).status, 200);
		assert.equal((await (await request(`/api/ciphers/${cipherId}`, { headers: auth })).json<{ folderId: string | null }>()).folderId, folderId);
		assert.equal((await request("/api/ciphers/move", { method: "POST", headers: auth, body: JSON.stringify({ ids: [cipherId], folderId: null }) })).status, 200);

		const createCipher = async (name: string) => {
			const response = await request("/api/ciphers/create", { method: "POST", headers: auth, body: JSON.stringify({ type: 1, name, login: { username: "encrypted-user", password: "encrypted-password" } }) });
			assert.equal(response.status, 200, await response.clone().text());
			return (await response.json<{ id: string }>()).id;
		};
		const singleId = await createCipher("encrypted-single-delete");
		assert.equal((await request(`/api/ciphers/${singleId}`, { method: "POST", headers: auth, body: JSON.stringify({ type: 1, name: "encrypted-updated", login: { username: "encrypted-user", password: "encrypted-password" } }) })).status, 200);
		assert.equal((await request(`/api/ciphers/${singleId}`, { method: "DELETE", headers: auth })).status, 200);
		assert.equal((await request(`/api/ciphers/${singleId}`, { headers: auth })).status, 404);

		const softId = await createCipher("encrypted-bulk-soft-delete");
		assert.equal((await request("/api/ciphers/delete", { method: "PUT", headers: auth, body: JSON.stringify({ ids: [softId] }) })).status, 200);
		assert.ok((await (await request(`/api/ciphers/${softId}`, { headers: auth })).json<{ deletedDate: string | null }>()).deletedDate);
		assert.equal((await request("/api/ciphers/delete", { method: "POST", headers: auth, body: JSON.stringify({ ids: [softId] }) })).status, 200);
		assert.equal((await request(`/api/ciphers/${softId}`, { headers: auth })).status, 404);
		assert.equal((await request(`/api/folders/${folderId}/delete`, { method: "POST", headers: auth })).status, 200);
	});

	test("uploads encrypted attachments with scoped short-lived URLs", async () => {
		const auth = { authorization: `Bearer ${accessToken}` };
		const encryptedBytes = new TextEncoder().encode("encrypted-attachment-payload");
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
		const metadata = await created.json<{ attachmentId: string; url: string }>();

		const crossUser = await request(`/api/ciphers/${cipherId}/attachment/${metadata.attachmentId}`, {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(crossUser.status, 404);

		const uploadUrl = new URL(metadata.url);
		const wrongSize = await request(`${uploadUrl.pathname}${uploadUrl.search}`, {
			method: "PUT",
			headers: { "content-type": "application/octet-stream", "content-length": "1" },
			body: new Uint8Array([1]),
		});
		assert.equal(wrongSize.status, 400);

		const uploaded = await request(`${uploadUrl.pathname}${uploadUrl.search}`, {
			method: "PUT",
			headers: { "content-type": "application/octet-stream", "content-length": String(encryptedBytes.byteLength) },
			body: encryptedBytes,
		});
		assert.equal(uploaded.status, 201, await uploaded.clone().text());

		const replay = await request(`${uploadUrl.pathname}${uploadUrl.search}`, {
			method: "PUT",
			headers: { "content-type": "application/octet-stream", "content-length": String(encryptedBytes.byteLength) },
			body: encryptedBytes,
		});
		assert.equal(replay.status, 409);

		const downloaded = await request(`/api/ciphers/${cipherId}/attachment/${metadata.attachmentId}`, { headers: auth });
		assert.equal(downloaded.status, 200, await downloaded.clone().text());
		assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), encryptedBytes);
		assert.equal(downloaded.headers.get("cache-control"), "private, no-store");

		const cipher = await request(`/api/ciphers/${cipherId}`, { headers: auth });
		const attachment = (await cipher.json<{ attachments: Array<{ id: string; fileName: string; key: string }> }>()).attachments[0];
		assert.equal(attachment.id, metadata.attachmentId);
		assert.equal(attachment.fileName, "2.encrypted-file-name");
		assert.equal(attachment.key, "2.encrypted-attachment-key");

		const removed = await request(`/api/ciphers/${cipherId}/attachment/${metadata.attachmentId}/delete`, { method: "POST", headers: auth });
		assert.equal(removed.status, 204, await removed.clone().text());
		const gone = await request(`/api/ciphers/${cipherId}/attachment/${metadata.attachmentId}`, { headers: auth });
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
			headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
			body: JSON.stringify({ text: { text: "updated-encrypted-text", hidden: false } }),
		});
		assert.equal(updated.status, 200, await updated.clone().text());
		assert.equal((await updated.json<{ text: { text: string } }>()).text.text, "updated-encrypted-text");

		const accessed = await request(`/api/sends/access/${sendAccessId}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		assert.equal(accessed.status, 200);
		assert.equal((await accessed.json<{ text: { text: string } }>()).text.text, "updated-encrypted-text");
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
			const response = await request("/api/sends", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ type: 0, name, key: "encrypted-key", text: { text: "encrypted-text", hidden: false }, deletionDate: new Date(Date.now() + 86_400_000).toISOString() }) });
			assert.equal(response.status, 200, await response.clone().text());
			return (await response.json<{ id: string }>()).id;
		};
		const ownedId = await createSend(accessToken, "encrypted-bulk-send");
		const otherUserId = await createSend(memberAccessToken, "encrypted-other-send");
		const deleted = await request("/api/sends/delete", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ ids: [ownedId, otherUserId] }) });
		assert.equal(deleted.status, 200, await deleted.clone().text());
		assert.equal(await testDatabase.prepare("SELECT COUNT(*) AS count FROM sends WHERE id = ?").bind(ownedId).first<{ count: number }>().then((row) => Number(row?.count)), 0);
		assert.equal(await testDatabase.prepare("SELECT COUNT(*) AS count FROM sends WHERE id = ?").bind(otherUserId).first<{ count: number }>().then((row) => Number(row?.count)), 1);
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
		const memberDenied = await request("/api/admin/users", { headers: { authorization: `Bearer ${memberAccessToken}` } });
		assert.equal(memberDenied.status, 403);

		const users = await request("/api/admin/users", { headers: adminAuth });
		assert.equal(users.status, 200, await users.clone().text());
		const userRows = (await users.json<{ data: Array<{ id: string; email: string; status: string }> }>()).data;
		const member = userRows.find((user) => user.email === MEMBER_EMAIL);
		assert.ok(member);

		const wrongPassword = await request("/api/admin/invites", {
			method: "POST",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({ masterPasswordHash: "wrong", expiresInHours: 24 }),
		});
		assert.equal(wrongPassword.status, 400);

		const created = await request("/api/admin/invites", {
			method: "POST",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH, expiresInHours: 24 }),
		});
		assert.equal(created.status, 201, await created.clone().text());
		const invite = await created.json<{ code: string; status: string; inviteLink: string }>();
		assert.equal(invite.status, "active");
		assert.match(invite.inviteLink, new RegExp(`/register\\?invite=${invite.code}$`));

		const invitedRegistration = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "invited-api-test@example.com",
				name: "Invited Test",
				masterPasswordHash: MASTER_PASSWORD_HASH,
				key: "encrypted-invited-key",
				kdf: 0,
				kdfIterations: 600_000,
				inviteCode: invite.code,
			}),
		});
		assert.equal(invitedRegistration.status, 204, await invitedRegistration.clone().text());

		const replayInvite = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "invite-replay@example.com", masterPasswordHash: MASTER_PASSWORD_HASH, key: "key", kdf: 0, kdfIterations: 600_000, inviteCode: invite.code }),
		});
		assert.equal(replayInvite.status, 400);

		const banned = await request(`/api/admin/users/${member.id}/status`, {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({ status: "banned", masterPasswordHash: MASTER_PASSWORD_HASH }),
		});
		assert.equal(banned.status, 200, await banned.clone().text());
		const restored = await request(`/api/admin/users/${member.id}/status`, {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({ status: "active", masterPasswordHash: MASTER_PASSWORD_HASH }),
		});
		assert.equal(restored.status, 200, await restored.clone().text());
		const relogin = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ grant_type: "password", username: MEMBER_EMAIL, password: MASTER_PASSWORD_HASH, deviceIdentifier: "member-test-device-restored", deviceName: "Restored Member Device", deviceType: "0" }),
		});
		assert.equal(relogin.status, 200, await relogin.clone().text());
		memberAccessToken = (await relogin.json<{ access_token: string }>()).access_token;

		const logs = await request("/api/admin/logs?category=admin&limit=20", { headers: adminAuth });
		assert.equal(logs.status, 200, await logs.clone().text());
		const entries = (await logs.json<{ data: Array<{ action: string; metadata: Record<string, unknown> }> }>()).data;
		assert.ok(entries.some((entry) => entry.action === "admin.invite.create"));
		assert.ok(entries.some((entry) => entry.action === "admin.user.status"));
		assert.ok(entries.every((entry) => !JSON.stringify(entry.metadata).match(/masterPasswordHash|test-secret|encrypted-/i)));

		const defaultSettings = await request("/api/admin/logs/settings", { headers: adminAuth });
		assert.equal(defaultSettings.status, 200);
		assert.deepEqual(await defaultSettings.json<any>().then((value) => [value.retentionDays, value.maxEntries]), [90, null]);
		assert.equal((await request("/api/admin/logs/settings", { headers: { authorization: `Bearer ${memberAccessToken}` } })).status, 403);
		const updatedSettings = await request("/api/admin/logs/settings", { method: "PUT", headers: { ...adminAuth, "content-type": "application/json" }, body: JSON.stringify({ retentionDays: null, maxEntries: 100 }) });
		assert.equal(updatedSettings.status, 200, await updatedSettings.clone().text());
		assert.deepEqual(await updatedSettings.json<any>().then((value) => [value.retentionDays, value.maxEntries]), [null, 100]);
	});

	test("resource middleware prevents cross-user cipher access", async () => {
		const response = await request(`/api/ciphers/${cipherId}`, {
			headers: { authorization: `Bearer ${memberAccessToken}` },
		});
		assert.equal(response.status, 404);
	});

	test("enforces organization collection visibility and read-only writes", async () => {
		const owner = await testDatabase.prepare("SELECT id FROM users WHERE email = ?").bind(EMAIL).first<{ id: string }>();
		const restrictedUser = await testDatabase.prepare("SELECT id FROM users WHERE email = ?").bind(MEMBER_EMAIL).first<{ id: string }>();
		assert.ok(owner?.id && restrictedUser?.id);
		const timestamp = Math.floor(Date.now() / 1000);
		const orgId = crypto.randomUUID();
		const ownerMemberId = crypto.randomUUID();
		const restrictedMemberId = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		await testDatabase.batch([
			testDatabase.prepare("INSERT INTO organizations (id,name,owner_id,public_key,private_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(orgId, "Test organization", owner.id, "public", "private", timestamp, timestamp),
			testDatabase.prepare("INSERT INTO org_members (id,org_id,user_id,email,role,status,access_all,key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(ownerMemberId, orgId, owner.id, EMAIL, "owner", "confirmed", 1, "owner-key", timestamp, timestamp),
			testDatabase.prepare("INSERT INTO org_members (id,org_id,user_id,email,role,status,access_all,key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(restrictedMemberId, orgId, restrictedUser.id, MEMBER_EMAIL, "member", "confirmed", 0, "member-key", timestamp, timestamp),
			testDatabase.prepare("INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").bind(collectionId, orgId, "encrypted-collection", timestamp, timestamp),
			testDatabase.prepare("INSERT INTO collection_members (collection_id,org_member_id,read_only,hide_passwords) VALUES (?,?,1,0)").bind(collectionId, restrictedMemberId),
		]);
		const restrictedCollections = await request("/api/collections", { headers: { authorization: `Bearer ${memberAccessToken}` } });
		assert.equal(restrictedCollections.status, 200, await restrictedCollections.clone().text());
		assert.deepEqual((await restrictedCollections.json<{ data: Array<{ id: string; readOnly: boolean }> }>()).data.map((collection) => [collection.id, collection.readOnly]), [[collectionId, true]]);
		const ownerCollections = await request("/api/collections", { headers: { authorization: `Bearer ${accessToken}` } });
		assert.deepEqual((await ownerCollections.json<{ data: Array<{ id: string; readOnly: boolean }> }>()).data.map((collection) => [collection.id, collection.readOnly]), [[collectionId, false]]);
		assert.equal((await request(`/api/organizations/${orgId}`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Renamed organization" }) })).status, 200);

		const payload = { type: 1, name: "encrypted-name", notes: null, favorite: false, folderId: null, organizationId: orgId, collectionIds: [collectionId], key: "encrypted-item-key", login: { username: "encrypted-user", password: "encrypted-password" } };
		const created = await request("/api/ciphers", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
		assert.equal(created.status, 200, await created.clone().text());
		const cipher = await created.json<{ id: string; organizationId: string; collectionIds: string[] }>();
		assert.equal(cipher.organizationId, orgId);
		assert.deepEqual(cipher.collectionIds, [collectionId]);
		const stored = await testDatabase.prepare("SELECT user_id, org_id, folder_id FROM ciphers WHERE id = ?").bind(cipher.id).first<{ user_id: string | null; org_id: string; folder_id: string | null }>();
		assert.deepEqual(stored, { user_id: null, org_id: orgId, folder_id: null });

		const visible = await request(`/api/ciphers/${cipher.id}`, { headers: { authorization: `Bearer ${memberAccessToken}` } });
		assert.equal(visible.status, 200, await visible.clone().text());
		assert.deepEqual(
			await visible.json<{ edit: boolean; viewPassword: boolean; permissions: { delete: boolean; restore: boolean } }>().then((value) => [value.edit, value.viewPassword, value.permissions.delete, value.permissions.restore]),
			[false, true, false, false],
		);
		const deniedWrite = await request(`/api/ciphers/${cipher.id}`, { method: "PUT", headers: { authorization: `Bearer ${memberAccessToken}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
		assert.equal(deniedWrite.status, 403);
		await testDatabase.prepare("UPDATE org_members SET role = 'manager' WHERE id = ?").bind(restrictedMemberId).run();
		assert.equal((await request(`/api/organizations/${orgId}/collections/${collectionId}`, { method: "POST", headers: { authorization: `Bearer ${memberAccessToken}`, "content-type": "application/json" }, body: JSON.stringify({ name: "encrypted-renamed-collection" }) })).status, 200);
		const escalation = await request(`/api/organizations/${orgId}/members`, { method: "POST", headers: { authorization: `Bearer ${memberAccessToken}`, "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com", role: "admin", accessAll: true, collections: [], key: "encrypted-key" }) });
		assert.equal(escalation.status, 403);

		await testDatabase.prepare("DELETE FROM collection_members WHERE collection_id = ? AND org_member_id = ?").bind(collectionId, restrictedMemberId).run();
		assert.deepEqual((await (await request("/api/collections", { headers: { authorization: `Bearer ${memberAccessToken}` } })).json<{ data: unknown[] }>()).data, []);
		const hidden = await request(`/api/ciphers/${cipher.id}`, { headers: { authorization: `Bearer ${memberAccessToken}` } });
		assert.equal(hidden.status, 404);
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
		await testDatabase.prepare("UPDATE users SET totp_secret = ?, totp_recovery_code = ? WHERE email = ?")
			.bind("JBSWY3DPEHPK3PXP", recoveryCode, EMAIL).run();
		const owner = await testDatabase.prepare("SELECT id FROM users WHERE email = ?").bind(EMAIL).first<{ id: string }>();
		assert.ok(owner?.id);
		const securityKeyId = crypto.randomUUID();
		const timestamp = Math.floor(Date.now() / 1000);
		await testDatabase.prepare("INSERT INTO webauthn_credentials (id,user_id,name,public_key,credential_id,counter,type,transports,supports_prf,created_at,updated_at,purpose) VALUES (?,?,?,?,?,0,'public-key','[]',0,?,?, 'twoFactor')")
			.bind(securityKeyId, owner.id, "recovery test key", "AQID", `recover-${securityKeyId}`, timestamp, timestamp).run();

		const invalid = await request("/identity/accounts/recover-2fa", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: EMAIL, masterPasswordHash: MASTER_PASSWORD_HASH, recoveryCode: "0000000000000000" }),
		});
		assert.equal(invalid.status, 400);

		const recovered = await request("/identity/accounts/recover-2fa", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: EMAIL.toUpperCase(), masterPasswordHash: MASTER_PASSWORD_HASH, recoveryCode: "a1b2-c3d4-e5f6-0718" }),
		});
		assert.equal(recovered.status, 204, await recovered.clone().text());
		const user = await testDatabase.prepare("SELECT totp_secret, totp_recovery_code FROM users WHERE email = ?").bind(EMAIL).first<{ totp_secret: string | null; totp_recovery_code: string | null }>();
		assert.equal(user?.totp_secret, null);
		assert.equal(user?.totp_recovery_code, null);
		assert.equal(await testDatabase.prepare("SELECT COUNT(*) AS count FROM webauthn_credentials WHERE id = ?").bind(securityKeyId).first<{ count: number }>().then((row) => Number(row?.count)), 0);
	});

	test("isolates login passkeys from two-factor WebAuthn credentials", async () => {
		const user = await testDatabase.prepare("SELECT id FROM users WHERE email = ?").bind(MEMBER_EMAIL).first<{ id: string }>();
		assert.ok(user?.id);
		const timestamp = Math.floor(Date.now() / 1000);
		const loginId = crypto.randomUUID();
		const twoFactorId = crypto.randomUUID();
		for (const [id, purpose] of [[loginId, "login"], [twoFactorId, "twoFactor"]] as const) {
			await testDatabase.prepare("INSERT INTO webauthn_credentials (id,user_id,name,public_key,credential_id,counter,type,transports,supports_prf,created_at,updated_at,purpose) VALUES (?,?,?,?,?,0,'public-key','[]',0,?,?,?)")
				.bind(id, user.id, `${purpose} key`, "AQID", `${purpose}-${id}`, timestamp, timestamp, purpose).run();
		}
		const auth = { authorization: `Bearer ${memberAccessToken}` };
		const accountKeys = await request("/api/webauthn", { headers: auth });
		assert.equal(accountKeys.status, 200);
		assert.deepEqual((await accountKeys.json<{ data: Array<{ id: string }> }>()).data.map((item) => item.id), [loginId]);

		const settings = await request("/api/two-factor/get-webauthn", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }) });
		assert.equal(settings.status, 200, await settings.clone().text());
		assert.deepEqual((await settings.json<{ keys: Array<{ id: string }> }>()).keys.map((item) => item.id), [twoFactorId]);

		const login = await request("/identity/connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: MEMBER_EMAIL, password: MASTER_PASSWORD_HASH }) });
		assert.equal(login.status, 400);
		const challenge = await login.json<any>();
		assert.ok(challenge.TwoFactorProviders.includes("7"));
		assert.ok(challenge.TwoFactorProviders2["7"].Challenge.token);

		const removed = await request("/api/two-factor/webauthn", { method: "DELETE", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH, id: twoFactorId }) });
		assert.equal(removed.status, 200, await removed.clone().text());
		assert.equal((await removed.json<{ enabled: boolean }>()).enabled, false);
		assert.equal(await testDatabase.prepare("SELECT COUNT(*) AS count FROM webauthn_credentials WHERE id = ?").bind(loginId).first<{ count: number }>().then((row) => Number(row?.count)), 1);
	});

	test("encrypts Yubico validation credentials and advertises YubiKey login", async () => {
		await testDatabase.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?").bind(JSON.stringify({ keys: ["ccccccbbbbbb"], nfc: true }), EMAIL).run();
		const session = await request("/identity/connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: EMAIL, password: MASTER_PASSWORD_HASH }) });
		assert.equal(session.status, 400);
		// Use a newly signed token by temporarily clearing the provider, then restore it before authenticated checks.
		await testDatabase.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?").bind(JSON.stringify({ keys: [], nfc: false }), EMAIL).run();
		const authenticated = await request("/identity/connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: EMAIL, password: MASTER_PASSWORD_HASH }) });
		assert.equal(authenticated.status, 200, await authenticated.clone().text());
		const auth = { authorization: `Bearer ${(await authenticated.json<{ access_token: string }>()).access_token}` };
		await testDatabase.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?").bind(JSON.stringify({ keys: ["ccccccbbbbbb"], nfc: true }), EMAIL).run();
		const secretKey = btoa("01234567890123456789");
		const configured = await request("/api/yubico-control/config", { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH, clientId: "12345", secretKey }) });
		assert.equal(configured.status, 200, await configured.clone().text());
		const stored = await testDatabase.prepare("SELECT value FROM config WHERE key = 'security.yubico.credentials.v1'").first<{ value: string }>();
		assert.ok(stored?.value);
		assert.doesNotMatch(stored.value, /12345|MDEyMzQ1Njc4/);

		const settings = await request("/api/yubico-enrollment/settings", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }) });
		assert.equal(settings.status, 200, await settings.clone().text());
		assert.deepEqual(await settings.json<any>().then((body) => [body.configured, body.enabled, body.nfc]), [true, true, true]);

		const login = await request("/identity/connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: EMAIL, password: MASTER_PASSWORD_HASH }) });
		assert.equal(login.status, 400);
		const body = await login.json<any>();
		assert.ok(body.TwoFactorProviders.includes("3"));
		assert.equal(body.TwoFactorProviders2["3"].Nfc, true);
		await testDatabase.prepare("UPDATE users SET yubikey_config = ? WHERE email = ?").bind(JSON.stringify({ keys: [], nfc: false }), EMAIL).run();
	});

	test("deletes an account only after password verification and blocks organization owners", async () => {
		const ownerLogin = await request("/identity/connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: EMAIL, password: MASTER_PASSWORD_HASH }) });
		assert.equal(ownerLogin.status, 200, await ownerLogin.clone().text());
		const ownerToken = (await ownerLogin.json<{ access_token: string }>()).access_token;
		const blocked = await request("/api/accounts/delete", { method: "POST", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }) });
		assert.equal(blocked.status, 409, await blocked.clone().text());

		const email = "delete-me@example.com";
		assert.equal((await request("/api/accounts/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, name: "Delete Me", masterPasswordHash: MASTER_PASSWORD_HASH, key: "encrypted-delete-key", kdf: 0, kdfIterations: 600_000 }) })).status, 204);
		const login = await request("/identity/connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: email, password: MASTER_PASSWORD_HASH, deviceIdentifier: "delete-device", deviceName: "Delete Device", deviceType: "14" }) });
		const token = (await login.json<{ access_token: string }>()).access_token;
		const wrongPassword = await request("/api/accounts/delete", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: "wrong" }) });
		assert.equal(wrongPassword.status, 400);
		const deleted = await request("/api/accounts", { method: "DELETE", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }) });
		assert.equal(deleted.status, 204, await deleted.clone().text());
		assert.equal(await testDatabase.prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?").bind(email).first<{ count: number }>().then((row) => Number(row?.count)), 0);
		assert.equal((await request("/api/accounts/profile", { headers: { authorization: `Bearer ${token}` } })).status, 401);
	});

	test("requires password verification and invalidates every session when removing all devices", async () => {
		const login = await request("/identity/connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: EMAIL, password: MASTER_PASSWORD_HASH, deviceIdentifier: "final-device", deviceName: "Final device", deviceType: "0" }) });
		assert.equal(login.status, 200, await login.clone().text());
		const token = (await login.json<{ access_token: string }>()).access_token;
		const removed = await request("/api/devices", { method: "DELETE", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }) });
		assert.equal(removed.status, 200, await removed.clone().text());
		assert.equal((await request("/api/accounts/profile", { headers: { authorization: `Bearer ${token}` } })).status, 401);
	});
});
