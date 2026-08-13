import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

interface InfrastructureScenarioContext {
	getBindings: () => CloudflareBindings;
	request: (
		path: string,
		init?: RequestInit,
		executionContext?: ExecutionContext,
	) => Promise<Response>;
}

export function registerInfrastructureScenarios(
	context: InfrastructureScenarioContext,
): void {
	const { getBindings, request } = context;
	test("declares every TEXT primary-key column as NOT NULL", () => {
		const migration = readFileSync(
			resolve(
				dirname(fileURLToPath(import.meta.url)),
				"../../migrations/0001_init.sql",
			),
			"utf8",
		);
		const nullableTextPrimaryKeys = migration.match(
			/^\s*[a-z_][a-z0-9_]*\s+TEXT\s+PRIMARY KEY(?!\s+NOT NULL).*$/gim,
		);
		assert.deepEqual(nullableTextPrimaryKeys, null);
	});

	test("advertises same-origin Fill Assist compatibility", async () => {
		const response = await request("https://vault.example.test/config");
		assert.equal(response.status, 200);
		const body = await response.json<{
			environment: { fillAssistRules: string };
			featureStates: Record<string, boolean>;
		}>();
		assert.equal(
			body.environment.fillAssistRules,
			"https://vault.example.test/fill-assist/",
		);
		assert.equal(body.featureStates["fill-assist-targeting-rules"], true);
	});

	test("advertises the current self-hosted client compatibility contract", async () => {
		const response = await request("https://vault.example.test/config");
		assert.equal(response.status, 200);
		const body = await response.json<{
			version: string;
			environment: { cloudRegion: string; notifications: string };
			push: { pushTechnology: number; vapidPublicKey: null };
			communication: null;
			settings: {
				disableUserRegistration: boolean;
				suppressOnboardingInterstitials: boolean;
			};
		}>();
		assert.equal(body.version, "2026.6.0");
		assert.deepEqual(body.environment, {
			cloudRegion: "self-hosted",
			notifications: "https://vault.example.test/notifications",
			vault: "https://vault.example.test",
			api: "https://vault.example.test/api",
			identity: "https://vault.example.test/identity",
			icons: "https://vault.example.test",
			fillAssistRules: "https://vault.example.test/fill-assist/",
			sso: "",
		});
		assert.deepEqual(body.push, {
			pushTechnology: 0,
			vapidPublicKey: null,
		});
		assert.equal(body.communication, null);
		assert.deepEqual(body.settings, {
			disableUserRegistration: false,
			suppressOnboardingInterstitials: false,
		});
	});

	test("reports readiness only when database and blob storage are available", async () => {
		const ready = await request("/api/health");
		assert.equal(ready.status, 200, await ready.clone().text());
		assert.deepEqual(await ready.json(), {
			status: "ok",
			edgewardenVersion: "1.0.0",
		});

		const bindings = getBindings() as unknown as Record<string, unknown>;
		const r2 = bindings.ATTACHMENTS_R2;
		const kv = bindings.ATTACHMENTS_KV;
		delete bindings.ATTACHMENTS_R2;
		delete bindings.ATTACHMENTS_KV;
		try {
			const unavailable = await request("/api/health");
			assert.equal(unavailable.status, 503);
			assert.deepEqual(await unavailable.json(), { status: "unavailable" });
		} finally {
			bindings.ATTACHMENTS_R2 = r2;
			bindings.ATTACHMENTS_KV = kv;
		}
	});

	test("requires a dedicated persisted-data encryption secret", async () => {
		const bindings = getBindings();
		const secret = bindings.DATA_ENCRYPTION_SECRET;
		delete (bindings as unknown as Record<string, unknown>)
			.DATA_ENCRYPTION_SECRET;
		try {
			const response = await request("/api/version");
			assert.equal(response.status, 500);
			assert.match(await response.text(), /DATA_ENCRYPTION_SECRET/);
		} finally {
			bindings.DATA_ENCRYPTION_SECRET = secret;
		}
	});

	test("sets strict browser security headers and rejects unknown CORS origins", async () => {
		const response = await request("/api/version", {
			headers: { origin: "https://evil.example" },
		});
		assert.equal(response.headers.get("access-control-allow-origin"), null);
		const csp = response.headers.get("content-security-policy") ?? "";
		assert.match(csp, /default-src 'self'/);
		assert.match(csp, /object-src 'none'/);
		assert.match(csp, /script-src-attr 'none'/);
	});

	test("rejects oversized JSON bodies before parsing", async () => {
		const response = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "x".repeat(10 * 1024 * 1024 + 1),
		});
		assert.equal(response.status, 413);
	});

	test("serves the empty Fill Assist ruleset with public caching", async () => {
		const manifest = await request("/fill-assist/manifest.json");
		assert.equal(manifest.status, 200);
		assert.equal(manifest.headers.get("cache-control"), "public, max-age=3600");
		const manifestBody = await manifest.json<{
			maps: { forms: { v1: { filename: string; schema: string } } };
		}>();
		assert.equal(manifestBody.maps.forms.v1.filename, "forms.v1.json");

		for (const filename of [
			manifestBody.maps.forms.v1.filename,
			manifestBody.maps.forms.v1.schema,
		]) {
			const response = await request(`/fill-assist/${filename}`);
			assert.equal(response.status, 200);
			assert.equal(
				response.headers.get("cache-control"),
				"public, max-age=3600",
			);
		}
		assert.equal((await request("/fill-assist/unknown.json")).status, 404);
		assert.deepEqual(
			await (await request("/.well-known/assetlinks/check")).json(),
			{
				linked: false,
				maxAge: "86400s",
				debugString:
					"No matching digital asset link policy is configured for this server.",
			},
		);
	});

	test("serves a local safe icon for invalid or private hosts", async () => {
		for (const host of ["localhost", "127.0.0.1", "internal.local"]) {
			const response = await request(`/icons/${host}/icon.png`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("content-type"), "image/svg+xml");
			assert.match(response.headers.get("cache-control") ?? "", /public/);
		}
	});

	test("caches validated public website icons at the edge", async () => {
		const originalFetch = globalThis.fetch;
		const originalCaches = Object.getOwnPropertyDescriptor(
			globalThis,
			"caches",
		);
		const cachedResponses = new Map<string, Response>();
		const backgroundTasks: Promise<unknown>[] = [];
		let upstreamRequests = 0;
		Object.defineProperty(globalThis, "caches", {
			configurable: true,
			value: {
				default: {
					match: async (key: Request) => cachedResponses.get(key.url)?.clone(),
					put: async (key: Request, response: Response) => {
						cachedResponses.set(key.url, response.clone());
					},
				},
			},
		});
		globalThis.fetch = async () => {
			upstreamRequests += 1;
			return new Response(new Uint8Array([137, 80, 78, 71]), {
				headers: {
					"content-type": "image/png",
					"content-length": "4",
				},
			});
		};

		try {
			const first = await request("/icons/example.com/icon.png", {}, {
				waitUntil: (task: Promise<unknown>) => {
					backgroundTasks.push(task);
				},
				passThroughOnException: () => undefined,
				props: {},
			} as unknown as ExecutionContext);
			assert.equal(backgroundTasks.length, 1);
			await Promise.all(backgroundTasks);
			const second = await request("/icons/example.com/icon.png");
			assert.equal(first.status, 200);
			assert.equal(second.status, 200);
			assert.equal(upstreamRequests, 1);
			assert.equal(
				first.headers.get("cache-control"),
				"public, max-age=604800",
			);
			assert.deepEqual(
				new Uint8Array(await second.arrayBuffer()),
				new Uint8Array([137, 80, 78, 71]),
			);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalCaches) {
				Object.defineProperty(globalThis, "caches", originalCaches);
			} else {
				delete (globalThis as { caches?: CacheStorage }).caches;
			}
		}
	});
}
