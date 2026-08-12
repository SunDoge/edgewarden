import { describe, expect, it, vi } from "vitest";
import {
	createRpcClient,
	getMemoryAccessToken,
	setMemoryAccessToken,
} from "./rpc";

describe("Hono RPC client", () => {
	it("builds typed path parameters and JSON requests", async () => {
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				Response.json({ id: "cipher-id", object: "cipher" }),
		);
		const client = createRpcClient("http://localhost", {
			fetch: fetchMock,
			accessToken: () => "test-access-token",
		});

		await client.api.ciphers[":id"].$put({
			param: { id: "cipher-id" },
			json: { type: 1, name: "encrypted-name" },
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as [
			RequestInfo | URL,
			RequestInit,
		];
		expect(url).toBe("http://localhost/api/ciphers/cipher-id");
		expect(init.method).toBe("PUT");
		expect(new Headers(init.headers).get("content-type")).toBe(
			"application/json",
		);
		expect(new Headers(init.headers).get("authorization")).toBe(
			"Bearer test-access-token",
		);
		expect(init.body).toBe(JSON.stringify({ type: 1, name: "encrypted-name" }));
	});

	it("normalizes API error responses", async () => {
		const client = createRpcClient("http://localhost", {
			fetch: vi.fn(async () =>
				Response.json({ message: "Invalid request payload" }, { status: 400 }),
			),
		});

		await expect(
			client.identity.accounts.prelogin.$post({ json: { email: "invalid" } }),
		).rejects.toEqual(
			expect.objectContaining({
				name: "ApiError",
				message: "Invalid request payload",
				status: 400,
				payload: { message: "Invalid request payload" },
			}),
		);
	});

	it("keeps the access token in memory and sends same-origin credentials", async () => {
		setMemoryAccessToken("memory-only-token");
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				Response.json({ version: "test" }),
		);
		const client = createRpcClient("http://localhost", { fetch: fetchMock });
		await client.api.version.$get();
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(getMemoryAccessToken()).toBe("memory-only-token");
		expect(new Headers(init.headers).get("authorization")).toBe(
			"Bearer memory-only-token",
		);
		expect(init.credentials).toBe("same-origin");
		setMemoryAccessToken(null);
	});
});
