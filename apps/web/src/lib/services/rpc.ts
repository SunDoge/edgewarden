import type { AppType } from "@edgewarden/api/contract";
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

let accessTokenInMemory: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function getMemoryAccessToken(): string | null {
  return accessTokenInMemory;
}
export function setMemoryAccessToken(token: string | null): void {
  accessTokenInMemory = token;
}

async function refreshWebAccessToken(
  fetchImpl: typeof fetch,
  requestUrl: URL,
): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetchImpl(
        new URL("/identity/connect/token", requestUrl),
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          credentials: "include",
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: "web",
          }),
        },
      );
      if (!response.ok) {
        accessTokenInMemory = null;
        return null;
      }
      const body = (await response.json()) as { access_token?: string };
      accessTokenInMemory = body.access_token ?? null;
      return accessTokenInMemory;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function restoreWebSession(): Promise<boolean> {
  if (accessTokenInMemory) return true;
  if (typeof window === "undefined") return false;
  // One-time cleanup for sessions created before tokens moved to HttpOnly cookies.
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  return Boolean(
    await refreshWebAccessToken(fetch, new URL(window.location.origin)),
  );
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
  if (typeof window !== "undefined" && !headers.has("X-Device-Identifier"))
    headers.set("X-Device-Identifier", getOrCreateDeviceIdentifier());

  const response = await fetchImpl(input, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (response.ok) return response;
  const requestUrl = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  if (
    response.status === 401 &&
    !requestUrl.pathname.endsWith("/identity/connect/token")
  ) {
    const refreshed = await refreshWebAccessToken(fetchImpl, requestUrl);
    if (refreshed) {
      headers.set("authorization", `Bearer ${refreshed}`);
      return fetchImpl(input, { ...init, headers, credentials: "same-origin" });
    }
  }

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
  const accessToken = options.accessToken ?? getMemoryAccessToken;
  return hc<AppType>(baseUrl, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      authenticatedFetch(input, init, fetchImpl, accessToken),
  });
}

export const rpc = createRpcClient(apiOrigin);

export async function rpcJson<T>(response: { json(): Promise<T> }): Promise<T> {
  return response.json();
}

/** Await a successful RPC whose response deliberately has no body (for example 204). */
export function rpcVoid(_response: Response): void {}
