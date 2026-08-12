import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { app } from "../index";

export interface ApiTestHarness {
	bindings: CloudflareBindings;
	database: D1Database;
	r2Values: Map<string, Uint8Array>;
	request: (
		path: string,
		init?: RequestInit,
		executionContext?: ExecutionContext,
	) => Promise<Response>;
	dispose: () => Promise<void>;
}

async function applyMigrations(database: D1Database): Promise<void> {
	const directory = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../migrations",
	);
	const statements = readdirSync(directory)
		.filter((file) => /^\d+.*\.sql$/.test(file))
		.sort()
		.map((file) => readFileSync(resolve(directory, file), "utf8"))
		.join("\n")
		.replace(/--.*$/gm, "")
		.split(";")
		.map((statement) => statement.trim())
		.filter(
			(statement) => statement && !statement.startsWith("PRAGMA foreign_keys"),
		);
	for (const [index, statement] of statements.entries()) {
		try {
			await database.prepare(statement).run();
		} catch (error) {
			throw new Error(`Migration statement ${index + 1} failed: ${statement}`, {
				cause: error,
			});
		}
	}
}

export async function createApiTestHarness(secrets: {
	adminPassword: string;
	jwtSecret: string;
	dataEncryptionSecret: string;
}): Promise<ApiTestHarness> {
	const miniflare = new Miniflare({
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
	const database = await miniflare.getD1Database("DB");
	await applyMigrations(database);

	const r2Values = new Map<string, Uint8Array>();
	const rateLimiter = { limit: async () => ({ success: true }) };
	const bindings = {
		DB: database,
		ATTACHMENTS_KV: await miniflare.getKVNamespace("ATTACHMENTS_KV"),
		ATTACHMENTS_R2: {
			put: async (key: string, value: unknown) => {
				const bytes =
					value instanceof ReadableStream
						? new Uint8Array(await new Response(value).arrayBuffer())
						: new Uint8Array(value as ArrayBuffer);
				r2Values.set(key, bytes);
			},
			get: async (key: string) => {
				const bytes = r2Values.get(key);
				return bytes
					? {
							body: new Response(bytes).body,
							size: bytes.byteLength,
							httpMetadata: { contentType: "application/octet-stream" },
						}
					: null;
			},
			delete: async (key: string) => {
				r2Values.delete(key);
			},
		},
		ATTACHMENT_STORAGE: "r2",
		ADMIN_PASSWORD: secrets.adminPassword,
		SIGNUPS_ALLOWED: "true",
		INVITATIONS_ALLOWED: "true",
		JWT_SECRET: secrets.jwtSecret,
		DATA_ENCRYPTION_SECRET: secrets.dataEncryptionSecret,
		RL_IP: rateLimiter,
		RL_ACCOUNT: rateLimiter,
	} as unknown as CloudflareBindings;

	return {
		bindings,
		database,
		r2Values,
		request: async (path, init = {}, executionContext) =>
			app.request(path, init, bindings, executionContext),
		dispose: () => miniflare.dispose(),
	};
}
