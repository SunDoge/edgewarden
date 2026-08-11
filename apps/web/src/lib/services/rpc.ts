import type { AppType } from "@edgewarden/api";
import { hc } from "hono/client";
import { getOrCreateDeviceIdentifier } from "./client-device";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly payload: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

function getAccessToken(): string | null {
	if (typeof window === "undefined") return null;
	return localStorage.getItem("access_token");
}

async function readErrorPayload(response: Response): Promise<unknown> {
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		return response
			.clone()
			.json()
			.catch(() => null);
	}
	return response
		.clone()
		.text()
		.catch(() => null);
}

function errorMessage(payload: unknown, fallback: string): string {
	if (typeof payload === "string" && payload) return payload;
	if (payload && typeof payload === "object") {
		const body = payload as Record<string, unknown>;
		const message = body.message ?? body.error_description ?? body.error;
		if (typeof message === "string" && message) return message;
	}
	return fallback;
}

async function authenticatedFetch(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	fetchImpl: typeof fetch,
	accessToken: () => string | null,
): Promise<Response> {
	const headers = new Headers(init?.headers);
	const token = accessToken();
	if (token && !headers.has("authorization")) {
		headers.set("authorization", `Bearer ${token}`);
	}
	if (typeof window !== "undefined" && !headers.has("X-Device-Identifier")) headers.set("X-Device-Identifier", getOrCreateDeviceIdentifier());

	const response = await fetchImpl(input, { ...init, headers });
	if (response.ok) return response;

	const payload = await readErrorPayload(response);
	throw new ApiError(
		errorMessage(payload, response.statusText || `HTTP ${response.status}`),
		response.status,
		payload,
	);
}

const apiOrigin =
	typeof window === "undefined" ? "http://localhost" : window.location.origin;

export function createRpcClient(
	baseUrl: string,
	options: {
		fetch?: typeof fetch;
		accessToken?: () => string | null;
	} = {},
) {
	const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
	const accessToken = options.accessToken ?? getAccessToken;
	return hc<AppType>(baseUrl, {
		fetch: (input: RequestInfo | URL, init?: RequestInit) =>
			authenticatedFetch(input, init, fetchImpl, accessToken),
	});
}

export const rpc = createRpcClient(apiOrigin);

export async function rpcJson<T>(response: { json(): Promise<T> }): Promise<T> {
	return response.json();
}
