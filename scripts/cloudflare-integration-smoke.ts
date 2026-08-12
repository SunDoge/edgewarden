import {
	deriveMasterKey,
	deriveMasterPasswordHash,
} from "../apps/web/src/lib/services/crypto.ts";

const origin = process.env.EDGEWARDEN_SERVER;
const email = process.env.EDGEWARDEN_EMAIL;
const password = process.env.EDGEWARDEN_PASSWORD;
const insecureTls = process.env.EDGEWARDEN_INSECURE_TLS === "1";

if (insecureTls) {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
	console.warn(
		"EDGEWARDEN_INSECURE_TLS disables TLS certificate verification for this process.",
	);
}

if (!origin || !email || !password) {
	throw new Error(
		"EDGEWARDEN_SERVER, EDGEWARDEN_EMAIL, and EDGEWARDEN_PASSWORD must target a disposable integration-test account",
	);
}

let accessToken = "";
let folderId = "";
let cipherId = "";
let socket: WebSocket | null = null;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
	return fetch(new URL(path, origin), {
		...init,
		headers,
		signal: init.signal ?? AbortSignal.timeout(10_000),
	});
}

async function json<T>(response: Response): Promise<T> {
	if (!response.ok)
		throw new Error(`${response.status} ${await response.text()}`);
	return response.json() as Promise<T>;
}

async function login(): Promise<void> {
	const prelogin = await json<{ kdfIterations: number }>(
		await api("/identity/accounts/prelogin/password", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email }),
		}),
	);
	const masterKey = await deriveMasterKey(
		password!,
		email!,
		prelogin.kdfIterations,
	);
	const masterPasswordHash = await deriveMasterPasswordHash(
		masterKey,
		password!,
	);
	const form = new URLSearchParams({
		grant_type: "password",
		username: email!,
		password: masterPasswordHash,
		deviceIdentifier: crypto.randomUUID(),
		deviceName: "Cloudflare integration smoke",
		deviceType: "14",
	});
	const tokens = await json<{ access_token?: string; accessToken?: string }>(
		await api("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: form,
		}),
	);
	accessToken = tokens.access_token ?? tokens.accessToken ?? "";
	if (!accessToken)
		throw new Error("Login response did not contain an access token");
}

async function connectRealtime(): Promise<void> {
	const ticket = await json<{ token: string }>(
		await api("/api/notifications/token", { method: "POST" }),
	);
	const url = new URL("/api/notifications/hub", origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("ticket", ticket.token);
	socket = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("WebSocket open timeout")),
			5_000,
		);
		socket!.addEventListener(
			"open",
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true },
		);
		socket!.addEventListener(
			"error",
			() => {
				clearTimeout(timeout);
				reject(new Error("WebSocket connection failed"));
			},
			{ once: true },
		);
	});
}

function nextVaultRevision(): Promise<number> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("Realtime revision timeout")),
			5_000,
		);
		socket!.addEventListener(
			"message",
			(event) => {
				try {
					const message = JSON.parse(String(event.data)) as {
						type?: string;
						revisionDate?: number;
					};
					if (
						message.type === "vault-revision" &&
						Number.isFinite(message.revisionDate)
					) {
						clearTimeout(timeout);
						resolve(message.revisionDate!);
					}
				} catch {
					// Ignore unrelated messages until the timeout.
				}
			},
			{ once: true },
		);
	});
}

async function verifyRealtime(): Promise<void> {
	const revision = nextVaultRevision();
	const folder = await json<{ id: string }>(
		await api("/api/folders", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: `encrypted-realtime-smoke-${Date.now()}` }),
		}),
	);
	folderId = folder.id;
	await revision;
	const deleted = await api(`/api/folders/${folderId}`, { method: "DELETE" });
	if (!deleted.ok) throw new Error(`Folder cleanup failed: ${deleted.status}`);
	folderId = "";
}

async function verifyR2Attachment(): Promise<void> {
	const cipher = await json<{ id: string }>(
		await api("/api/ciphers", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				type: 1,
				name: "encrypted-r2-smoke",
				favorite: false,
				reprompt: 0,
				fields: [],
				login: { username: "encrypted-user", password: "encrypted-password" },
			}),
		}),
	);
	cipherId = cipher.id;
	const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
	const attachment = await json<{ attachmentId: string; url: string }>(
		await api(`/api/ciphers/${cipherId}/attachment/v2`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				fileName: "encrypted-file-name",
				key: "encrypted-attachment-key",
				fileSize: bytes.byteLength,
			}),
		}),
	);
	const uploaded = await fetch(attachment.url, {
		method: "PUT",
		headers: { "content-type": "application/octet-stream" },
		body: bytes,
		signal: AbortSignal.timeout(10_000),
	});
	if (!uploaded.ok)
		throw new Error(
			`Attachment upload failed: ${uploaded.status} ${await uploaded.text()}`,
		);
	const downloadedResponse = await api(
		`/api/ciphers/${cipherId}/attachment/${attachment.attachmentId}`,
	);
	if (!downloadedResponse.ok)
		throw new Error(`Attachment download failed: ${downloadedResponse.status}`);
	const downloaded = new Uint8Array(await downloadedResponse.arrayBuffer());
	if (
		downloaded.length !== bytes.length ||
		downloaded.some((value, index) => value !== bytes[index])
	) {
		throw new Error("R2 attachment bytes did not round-trip");
	}
	const deleted = await api(`/api/ciphers/${cipherId}`, { method: "DELETE" });
	if (!deleted.ok) throw new Error(`Cipher cleanup failed: ${deleted.status}`);
	cipherId = "";
}

async function cleanup(): Promise<void> {
	socket?.close(1000, "Integration test complete");
	if (folderId)
		await api(`/api/folders/${folderId}`, { method: "DELETE" }).catch(
			() => null,
		);
	if (cipherId)
		await api(`/api/ciphers/${cipherId}`, { method: "DELETE" }).catch(
			() => null,
		);
}

try {
	await json<{ status: "ok" }>(await api("/api/health"));
	await login();
	await connectRealtime();
	await verifyRealtime();
	await verifyR2Attachment();
	console.log(
		"Readiness, realtime, and attachment integration smoke test passed.",
	);
} finally {
	await cleanup();
}
