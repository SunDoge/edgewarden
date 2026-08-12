import assert from "node:assert/strict";
import { test } from "vitest";

export interface SendScenarioContext {
	readonly database: D1Database;
	readonly accessToken: string;
	readonly memberAccessToken: string;
	readonly cipherId: string;
	sendId: string;
	sendAccessId: string;
	request: (path: string, init?: RequestInit) => Promise<Response>;
	masterPasswordHash: string;
}

export function registerSendScenarios(context: SendScenarioContext): void {
	const request = context.request;
	const MASTER_PASSWORD_HASH = context.masterPasswordHash;
	test("validates and creates a text Send with an atomic revision update", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
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
		context.sendId = send.id;
		context.sendAccessId = send.accessId;
	});

	test("serves public Sends while private Send middleware hides unknown ids", async () => {
		const missing = await request(`/api/sends/${crypto.randomUUID()}`, {
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.equal(missing.status, 404);

		const accessed = await request(
			`/api/sends/access/${context.sendAccessId}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		assert.equal(accessed.status, 200, await accessed.clone().text());
		const body = await accessed.json<{
			id: string;
			text: { text: string };
		}>();
		assert.equal(body.id, context.sendId);
		assert.equal(body.text.text, "encrypted-send-text");
	});

	test("enforces a Send access limit under concurrency", async () => {
		const created = await request("/api/sends", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				type: 0,
				name: "limited-encrypted-send",
				key: "encrypted-send-key",
				text: { text: "limited-encrypted-text", hidden: false },
				maxAccessCount: 1,
				deletionDate: new Date(Date.now() + 86_400_000).toISOString(),
			}),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const send = await created.json<{ id: string; accessId: string }>();
		const access = () =>
			request(`/api/sends/access/${send.accessId}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			});
		const responses = await Promise.all([access(), access()]);
		assert.deepEqual(
			responses.map((response) => response.status).sort(),
			[200, 404],
		);
		assert.equal(
			await context.database
				.prepare("SELECT access_count FROM sends WHERE id = ?")
				.bind(send.id)
				.first<{ access_count: number }>()
				.then((row) => row?.access_count),
			1,
		);
	});

	test("binds file Send download links to the published file version", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const firstBytes = new Uint8Array([1, 2, 3, 4]);
		const secondBytes = new Uint8Array([5, 6, 7, 8]);
		const created = await request("/api/sends/file/v2", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				type: 1,
				name: "encrypted-file-send-name",
				key: "encrypted-file-send-key",
				fileLength: firstBytes.byteLength,
				file: { fileName: "encrypted-file-name" },
				deletionDate: new Date(Date.now() + 86_400_000).toISOString(),
			}),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const metadata = await created.json<{
			url: string;
			sendResponse: {
				id: string;
				accessId: string;
				file: { id: string };
			};
		}>();
		const uploadUrl = new URL(metadata.url);
		const upload = (bytes: Uint8Array) =>
			request(`${uploadUrl.pathname}${uploadUrl.search}`, {
				method: "PUT",
				headers: {
					"content-type": "application/octet-stream",
					"content-length": String(bytes.byteLength),
				},
				body: bytes,
			});
		assert.equal((await upload(firstBytes)).status, 201);

		const issueDownload = async () => {
			const response = await request(
				`/api/sends/${metadata.sendResponse.accessId}/access/file/${metadata.sendResponse.file.id}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			assert.equal(response.status, 200, await response.clone().text());
			return new URL((await response.json<{ url: string }>()).url);
		};
		const firstDownloadUrl = await issueDownload();
		const download = (url: URL) => request(`${url.pathname}${url.search}`);
		const firstDownload = await download(firstDownloadUrl);
		assert.equal(firstDownload.status, 200);
		assert.deepEqual(
			new Uint8Array(await firstDownload.arrayBuffer()),
			firstBytes,
		);

		assert.equal((await upload(secondBytes)).status, 201);
		assert.equal((await download(firstDownloadUrl)).status, 404);

		const secondDownloadUrl = await issueDownload();
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const retried = await download(secondDownloadUrl);
			assert.equal(retried.status, 200);
			assert.deepEqual(
				new Uint8Array(await retried.arrayBuffer()),
				secondBytes,
			);
		}

		const disabled = await request(`/api/sends/${metadata.sendResponse.id}`, {
			method: "PUT",
			headers: auth,
			body: JSON.stringify({ disabled: true }),
		});
		assert.equal(disabled.status, 200, await disabled.clone().text());
		assert.equal((await download(secondDownloadUrl)).status, 404);
		await context.database
			.prepare("DELETE FROM sends WHERE id = ?")
			.bind(metadata.sendResponse.id)
			.run();
	});

	test("updates text Send data without replacing it with an incompatible shape", async () => {
		const updated = await request(`/api/sends/${context.sendId}`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
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

		const accessed = await request(
			`/api/sends/access/${context.sendAccessId}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		assert.equal(accessed.status, 200);
		assert.equal(
			(await accessed.json<{ text: { text: string } }>()).text.text,
			"updated-encrypted-text",
		);
	});

	test("validates passkey requests before WebAuthn processing", async () => {
		const auth = { authorization: `Bearer ${context.accessToken}` };
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
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.equal(response.status, 200);
		const sync = await response.json<{
			ciphers: Array<{ id: string; fields: unknown[] | null }>;
			sends: Array<{ id: string }>;
		}>();
		assert.equal(
			sync.ciphers.find((cipher) => cipher.id === context.cipherId)?.fields
				?.length,
			1,
		);
		assert.ok(sync.sends.some((send) => send.id === context.sendId));
	});

	test("advances revision and audit once for concurrent Send deletion", async () => {
		const auth = {
			authorization: `Bearer ${context.accessToken}`,
			"content-type": "application/json",
		};
		const created = await request("/api/sends", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				type: 0,
				name: "concurrent-delete-send",
				key: "encrypted-key",
				text: { text: "encrypted-text", hidden: false },
				deletionDate: new Date(Date.now() + 86_400_000).toISOString(),
			}),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const sendId = (await created.json<{ id: string }>()).id;
		const owner = await context.database
			.prepare("SELECT user_id FROM sends WHERE id = ?")
			.bind(sendId)
			.first<{ user_id: string }>();
		assert.ok(owner);
		const before = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(owner.user_id)
			.first<{ revision_date: number }>();
		assert.ok(before);

		const responses = await Promise.all([
			request(`/api/sends/${sendId}`, { method: "DELETE", headers: auth }),
			request(`/api/sends/${sendId}`, { method: "DELETE", headers: auth }),
		]);
		assert.ok(responses.some((response) => response.status === 200));
		assert.ok(
			responses.every((response) => [200, 404].includes(response.status)),
		);
		const after = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(owner.user_id)
			.first<{ revision_date: number }>();
		assert.equal(after?.revision_date, before.revision_date + 1);
		assert.equal(
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'send.delete' AND target_id = ?",
				)
				.bind(sendId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
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
		const ownedId = await createSend(
			context.accessToken,
			"encrypted-bulk-send",
		);
		const otherUserId = await createSend(
			context.memberAccessToken,
			"encrypted-other-send",
		);
		const deleted = await request("/api/sends/delete", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ids: [ownedId, otherUserId] }),
		});
		assert.equal(deleted.status, 200, await deleted.clone().text());
		const ownedTombstone = await context.database
			.prepare("SELECT deletion_date FROM sends WHERE id = ?")
			.bind(ownedId)
			.first<{ deletion_date: number }>();
		assert.ok(ownedTombstone);
		assert.ok(ownedTombstone.deletion_date <= Math.floor(Date.now() / 1000));
		const hidden = await request(`/api/sends/${ownedId}`, {
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.equal(hidden.status, 404);
		assert.equal(
			await context.database
				.prepare("SELECT COUNT(*) AS count FROM sends WHERE id = ?")
				.bind(otherUserId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
	});
}
