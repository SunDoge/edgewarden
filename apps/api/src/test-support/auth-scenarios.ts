import assert from "node:assert/strict";
import { test } from "vitest";

export interface AuthScenarioContext {
	readonly bindings: CloudflareBindings;
	readonly database: D1Database;
	accessToken: string;
	refreshToken: string;
	memberAccessToken: string;
	request: (
		path: string,
		init?: RequestInit,
		executionContext?: ExecutionContext,
	) => Promise<Response>;
	email: string;
	memberEmail: string;
	masterPasswordHash: string;
	adminPassword: string;
}

export function registerAuthScenarios(context: AuthScenarioContext): void {
	const request = context.request;
	const EMAIL = context.email;
	const MEMBER_EMAIL = context.memberEmail;
	const MASTER_PASSWORD_HASH = context.masterPasswordHash;
	const ADMIN_PASSWORD = context.adminPassword;
	test("rejects invalid registration payloads through Valibot", async () => {
		const response = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "not-an-email" }),
		});
		assert.equal(response.status, 400);
	});

	test("requires the deployment admin password for the first account", async () => {
		const config = await request("/api/config");
		assert.equal(config.status, 200);
		const configBody = await config.json<{
			registration: Record<string, unknown>;
		}>();
		assert.deepEqual(configBody.registration, {
			signupsAllowed: true,
			invitationsAllowed: true,
			bootstrapRequired: true,
			adminPasswordConfigured: true,
		});
		assert.equal(JSON.stringify(configBody).includes(ADMIN_PASSWORD), false);

		for (const adminPassword of [undefined, "incorrect-password"]) {
			const response = await request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "bootstrap-rejected@example.com",
					masterPasswordHash: MASTER_PASSWORD_HASH,
					key: "encrypted-user-key",
					kdf: 0,
					kdfIterations: 600_000,
					adminPassword,
				}),
			});
			assert.equal(response.status, 403);
		}
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
				adminPassword: ADMIN_PASSWORD,
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
		context.accessToken = tokenBody.access_token;
		context.refreshToken = tokenBody.refresh_token;
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
		context.memberAccessToken = (
			await login.json<{ access_token: string }>()
		).access_token;
	});

	test("blocks registration without an invite when public signups are disabled", async () => {
		(context.bindings as unknown as Record<string, unknown>).SIGNUPS_ALLOWED =
			"false";
		try {
			const response = await request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "closed-registration@example.com",
					masterPasswordHash: MASTER_PASSWORD_HASH,
					key: "encrypted-key",
					kdf: 0,
					kdfIterations: 600_000,
				}),
			});
			assert.equal(response.status, 403);
		} finally {
			(context.bindings as unknown as Record<string, unknown>).SIGNUPS_ALLOWED =
				"true";
		}
	});

	test("rotates refresh tokens and rejects replay", async () => {
		const previousRefreshToken = context.refreshToken;
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
		context.accessToken = tokens.access_token;
		context.refreshToken = tokens.refresh_token;
		assert.notEqual(context.refreshToken, previousRefreshToken);

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

	test("allows only one concurrent refresh-token rotation", async () => {
		const previousRefreshToken = context.refreshToken;
		const rotate = () =>
			request("/identity/connect/token", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: previousRefreshToken,
				}),
			});
		const responses = await Promise.all([rotate(), rotate()]);
		assert.deepEqual(
			responses.map((response) => response.status).sort(),
			[200, 400],
		);
		const winner = responses.find((response) => response.status === 200);
		assert.ok(winner);
		const tokens = await winner.json<{
			access_token: string;
			refresh_token: string;
		}>();
		context.accessToken = tokens.access_token;
		context.refreshToken = tokens.refresh_token;
	});

	test("keeps concurrent first logins for one device valid", async () => {
		const deviceIdentifier = `concurrent-device-${crypto.randomUUID()}`;
		const login = () =>
			request("/identity/connect/token", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "password",
					username: EMAIL,
					password: MASTER_PASSWORD_HASH,
					deviceIdentifier,
					deviceName: "Concurrent device",
					deviceType: "0",
				}),
			});
		const responses = await Promise.all([login(), login()]);
		assert.deepEqual(
			responses.map((response) => response.status),
			[200, 200],
		);
		const tokens = await Promise.all(
			responses.map((response) =>
				response.json<{ access_token: string; refresh_token: string }>(),
			),
		);
		for (const token of tokens) {
			assert.equal(
				(
					await request("/api/accounts/profile", {
						headers: { authorization: `Bearer ${token.access_token}` },
					})
				).status,
				200,
			);
		}
	});

	test("keeps web refresh tokens out of JavaScript-readable responses", async () => {
		const login = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				client_id: "web",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(login.status, 200, await login.clone().text());
		const body = await login.json<Record<string, unknown>>();
		assert.equal("refresh_token" in body, false);
		const cookie = login.headers.get("set-cookie") ?? "";
		assert.match(cookie, /edgewarden_refresh=/);
		assert.match(cookie, /HttpOnly/i);
		assert.match(cookie, /SameSite=Strict/i);

		const refreshed = await request("/identity/connect/token", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				cookie: cookie.split(";")[0],
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				client_id: "web",
			}),
		});
		assert.equal(refreshed.status, 200, await refreshed.clone().text());
		assert.equal(
			"refresh_token" in (await refreshed.json<Record<string, unknown>>()),
			false,
		);
		const refreshedCookie =
			(refreshed.headers.get("set-cookie") ?? "").split(";")[0] ||
			cookie.split(";")[0];
		const revoked = await request("/identity/connect/revocation", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				cookie: refreshedCookie,
			},
			body: new URLSearchParams(),
		});
		assert.equal(revoked.status, 200, await revoked.clone().text());
		assert.match(revoked.headers.get("set-cookie") ?? "", /Max-Age=0/i);
		const replay = await request("/identity/connect/token", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				cookie: refreshedCookie,
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				client_id: "web",
			}),
		});
		assert.equal(replay.status, 400);
	});

	test("revokes an explicit refresh token idempotently", async () => {
		const login = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
				deviceIdentifier: `revocation-${crypto.randomUUID()}`,
				deviceName: "Revocation test",
				deviceType: "14",
			}),
		});
		assert.equal(login.status, 200, await login.clone().text());
		const refreshToken = (await login.json<{ refresh_token: string }>())
			.refresh_token;
		const revoke = () =>
			request("/identity/connect/revoke", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ token: refreshToken }),
			});
		assert.equal((await revoke()).status, 200);
		assert.equal((await revoke()).status, 200);
		const replay = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}),
		});
		assert.equal(replay.status, 400);
	});

	test("persists account login lockout across requests", async () => {
		const payload = new URLSearchParams({
			grant_type: "password",
			username: "missing-account@example.com",
			password: "invalid-password-hash",
		});
		for (let attempt = 0; attempt < 5; attempt++) {
			const response = await request("/identity/connect/token", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: payload,
			});
			assert.equal(response.status, 400);
		}
		const locked = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: payload,
		});
		assert.equal(locked.status, 429);
		const stored = await context.database
			.prepare("SELECT identifier_hash FROM login_attempts LIMIT 1")
			.first<{ identifier_hash: string }>();
		assert.ok(stored);
		assert.notEqual(stored.identifier_hash, "missing-account@example.com");
	});

	test("issues dedicated realtime tickets and rejects invalid websocket tickets", async () => {
		(context.bindings as any).REALTIME = {
			getByName: () => ({ fetch: async () => new Response(null) }),
		};
		try {
			const ticketResponse = await request("/api/notifications/token", {
				method: "POST",
				headers: { authorization: `Bearer ${context.accessToken}` },
			});
			assert.equal(
				ticketResponse.status,
				200,
				await ticketResponse.clone().text(),
			);
			const ticket = await ticketResponse.json<{
				token: string;
				expiresIn: number;
				object: string;
			}>();
			assert.equal(typeof ticket.token, "string");
			assert.deepEqual(
				[ticket.expiresIn, ticket.object],
				[60, "realtimeTicket"],
			);

			const invalid = await request("/api/notifications/hub?ticket=invalid", {
				headers: { Upgrade: "websocket" },
			});
			assert.equal(invalid.status, 401);
		} finally {
			delete (context.bindings as any).REALTIME;
		}
	});

	test("enforces Turnstile on password login when configured", async () => {
		(context.bindings as any).TURNSTILE_SECRET_KEY = "turnstile-test-secret";
		(context.bindings as any).TURNSTILE_SITE_KEY = "turnstile-test-site-key";
		const originalFetch = globalThis.fetch;
		try {
			const config = await request("/api/config");
			const configBody = await config.json<{
				turnstile: { enabled: boolean; siteKey: string | null };
			}>();
			assert.deepEqual(configBody.turnstile, {
				enabled: true,
				siteKey: "turnstile-test-site-key",
			});
			assert.equal(
				JSON.stringify(configBody).includes("turnstile-test-secret"),
				false,
			);

			const form = new URLSearchParams({
				grant_type: "password",
				username: EMAIL,
				password: MASTER_PASSWORD_HASH,
				deviceIdentifier: "turnstile-test-device",
				deviceName: "Turnstile Test Device",
				deviceType: "14",
			});
			const missing = await request("/identity/connect/token", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: form,
			});
			assert.equal(missing.status, 400);
			assert.equal(
				(await missing.json<{ error: string }>()).error,
				"CaptchaRequired",
			);

			globalThis.fetch = async (_input, init) => {
				const submitted = init?.body as FormData;
				assert.equal(submitted.get("secret"), "turnstile-test-secret");
				assert.equal(submitted.get("response"), "valid-turnstile-token");
				return Response.json({ success: true, action: "login" });
			};
			form.set("captchaResponse", "valid-turnstile-token");
			const accepted = await request("/identity/connect/token", {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					"CF-Connecting-IP": "203.0.113.10",
				},
				body: form,
			});
			assert.equal(accepted.status, 200, await accepted.clone().text());
		} finally {
			globalThis.fetch = originalFetch;
			delete (context.bindings as any).TURNSTILE_SECRET_KEY;
			delete (context.bindings as any).TURNSTILE_SITE_KEY;
		}
	});

	test("enforces the register Turnstile action on account registration", async () => {
		(context.bindings as any).TURNSTILE_SECRET_KEY = "turnstile-test-secret";
		const originalFetch = globalThis.fetch;
		const payload = {
			email: "turnstile-registration@example.com",
			masterPasswordHash: MASTER_PASSWORD_HASH,
			key: "encrypted-key",
			kdf: 0,
			kdfIterations: 600_000,
		};
		try {
			const missing = await request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			});
			assert.equal(missing.status, 400);

			globalThis.fetch = async () =>
				Response.json({ success: true, action: "login" });
			const wrongAction = await request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...payload, captchaResponse: "login-token" }),
			});
			assert.equal(wrongAction.status, 400);

			globalThis.fetch = async () =>
				Response.json({ success: true, action: "register" });
			const accepted = await request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...payload, captchaResponse: "register-token" }),
			});
			assert.equal(accepted.status, 204, await accepted.clone().text());
		} finally {
			globalThis.fetch = originalFetch;
			delete (context.bindings as any).TURNSTILE_SECRET_KEY;
		}
	});
}
