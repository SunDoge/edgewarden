import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	bytesToBase64,
	deriveMasterKey,
	deriveMasterPasswordHash,
	encryptBw,
	hkdfExpand,
} from "../apps/web/src/lib/services/crypto.ts";

const root = resolve(import.meta.dirname, "..");
const persistencePath = await mkdtemp(
	join(tmpdir(), "edgewarden-compat-state-"),
);
const email = `bw-compat-${crypto.randomUUID()}@example.com`;
const password = `BwCompat-${crypto.randomUUID()}-aA1!`;
const server = "https://127.0.0.1:8787";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function parseDevVars(source: string): Record<string, string> {
	return Object.fromEntries(
		source
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#") && line.includes("="))
			.map((line) => {
				const separator = line.indexOf("=");
				const key = line.slice(0, separator).trim();
				const value = line
					.slice(separator + 1)
					.trim()
					.replace(/^(['"])(.*)\1$/, "$2");
				return [key, value];
			}),
	);
}

async function command(args: string[]): Promise<void> {
	await new Promise<void>((resolveCommand, reject) => {
		const child = spawn("pnpm", args, { cwd: root, stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) resolveCommand();
			else reject(new Error(`pnpm ${args.join(" ")} exited with ${code}`));
		});
	});
}

async function waitForServer(): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			const response = await fetch(`${server}/api/config`, {
				signal: AbortSignal.timeout(1_000),
			});
			if (response.ok) return;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
	throw new Error("Local compatibility Worker did not become ready", {
		cause: lastError,
	});
}

async function register(adminPassword: string): Promise<void> {
	const iterations = 600_000;
	const masterKey = await deriveMasterKey(password, email, iterations);
	const masterPasswordHash = await deriveMasterPasswordHash(
		masterKey,
		password,
	);
	const encKey = await hkdfExpand(new Uint8Array(masterKey), "enc", 32);
	const macKey = await hkdfExpand(new Uint8Array(masterKey), "mac", 32);
	const symmetricKey = crypto.getRandomValues(new Uint8Array(64));
	const protectedKey = await encryptBw(symmetricKey, encKey, macKey);
	const keyPair = await crypto.subtle.generateKey(
		{
			name: "RSA-OAEP",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-1",
		},
		true,
		["encrypt", "decrypt"],
	);
	const publicKey = new Uint8Array(
		await crypto.subtle.exportKey("spki", keyPair.publicKey),
	);
	const privateKey = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
	);
	const encryptedPrivateKey = await encryptBw(
		privateKey,
		symmetricKey.slice(0, 32),
		symmetricKey.slice(32),
	);
	const response = await fetch(`${server}/api/accounts/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			email,
			name: "Bitwarden compatibility test",
			masterPasswordHash,
			key: protectedKey,
			kdf: 0,
			kdfIterations: iterations,
			adminPassword,
			keys: { publicKey: bytesToBase64(publicKey), encryptedPrivateKey },
		}),
	});
	if (!response.ok) {
		throw new Error(
			`Local compatibility account registration failed: ${response.status} ${await response.text()}`,
		);
	}
}

const devVars = parseDevVars(
	await readFile(resolve(root, ".dev.vars"), "utf8"),
);
if (!devVars.BOOTSTRAP_SECRET) {
	throw new Error(".dev.vars must define BOOTSTRAP_SECRET");
}

await command([
	"exec",
	"wrangler",
	"d1",
	"migrations",
	"apply",
	"DB",
	"--config",
	"wrangler.jsonc",
	"--local",
	"--persist-to",
	persistencePath,
]);

const worker = spawn(
	"pnpm",
	[
		"exec",
		"wrangler",
		"dev",
		"--config",
		"wrangler.jsonc",
		"--port",
		"8787",
		"--local-protocol",
		"https",
		"--persist-to",
		persistencePath,
	],
	{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

try {
	await waitForServer();
	await register(devVars.BOOTSTRAP_SECRET);
	process.env.BW_SERVER = server;
	process.env.BW_EMAIL = email;
	process.env.BW_PASSWORD = password;
	await import("./bw-compat-smoke.ts");
} finally {
	worker.kill("SIGTERM");
	await new Promise<void>((resolveExit) => {
		if (worker.exitCode !== null) resolveExit();
		else worker.once("exit", () => resolveExit());
	});
	await rm(persistencePath, { recursive: true, force: true });
}
