import { createDatabase } from "../middleware/db";
import type { WorkerBindings } from "../worker-bindings";

type PushRegion = "US" | "EU";

export interface PushRelayStatus {
  enabled: boolean;
  region: PushRegion;
  installationIdConfigured: boolean;
  installationKeyConfigured: boolean;
  reason: "ready" | "missing_credentials" | "invalid_region";
}

interface PushRelayConfig extends PushRelayStatus {
  installationId: string;
  installationKey: string;
  identityUrl: string;
  relayUrl: string;
}

interface RelayDevice {
  deviceId: string;
  pushToken: string;
  userId: string;
  type: number;
  identifier: string;
  organizationIds: string[];
}

const ENDPOINTS = {
  US: {
    identityUrl: "https://identity.bitwarden.com",
    relayUrl: "https://push.bitwarden.com",
  },
  EU: {
    identityUrl: "https://identity.bitwarden.eu",
    relayUrl: "https://push.bitwarden.eu",
  },
} as const;

function relayConfig(env: WorkerBindings): PushRelayConfig {
  const requestedRegion = String(env.PUSH_REGION ?? "US")
    .trim()
    .toUpperCase();
  const validRegion = requestedRegion === "US" || requestedRegion === "EU";
  const region: PushRegion = requestedRegion === "EU" ? "EU" : "US";
  const installationId = String(env.PUSH_INSTALLATION_ID ?? "").trim();
  const installationKey = String(env.PUSH_INSTALLATION_KEY ?? "").trim();
  const installationIdConfigured = Boolean(installationId);
  const installationKeyConfigured = Boolean(installationKey);
  const enabled =
    validRegion && installationIdConfigured && installationKeyConfigured;
  return {
    enabled,
    region,
    installationIdConfigured,
    installationKeyConfigured,
    reason: !validRegion
      ? "invalid_region"
      : enabled
        ? "ready"
        : "missing_credentials",
    installationId,
    installationKey,
    ...ENDPOINTS[region],
  };
}

export function getPushRelayStatus(env: WorkerBindings): PushRelayStatus {
  const {
    enabled,
    region,
    installationIdConfigured,
    installationKeyConfigured,
    reason,
  } = relayConfig(env);
  return {
    enabled,
    region,
    installationIdConfigured,
    installationKeyConfigured,
    reason,
  };
}

async function tokenCacheKey(config: PushRelayConfig): Promise<Request> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${config.region}:${config.installationId}`),
  );
  const key = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return new Request(`https://push-token.edgewarden.invalid/${key}`);
}

async function accessToken(
  config: PushRelayConfig,
  fetcher: typeof fetch,
  cache: Cache | null,
): Promise<string> {
  const cacheKey = await tokenCacheKey(config);
  const cached = await cache?.match(cacheKey);
  if (cached) {
    const value = (await cached.json<{ accessToken?: unknown }>()).accessToken;
    if (typeof value === "string" && value) return value;
  }
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "api.push",
    client_id: `installation.${config.installationId}`,
    client_secret: config.installationKey,
  });
  const response = await fetcher(`${config.identityUrl}/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`Push identity returned ${response.status}`);
  const body = await response.json<{
    access_token?: unknown;
    expires_in?: unknown;
  }>();
  if (typeof body.access_token !== "string" || !body.access_token)
    throw new Error("Push identity returned an invalid access token");
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.max(60, Math.floor(body.expires_in / 2))
      : 300;
  if (cache) {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify({ accessToken: body.access_token }), {
        headers: {
          "content-type": "application/json",
          "cache-control": `max-age=${expiresIn}`,
        },
      }),
    );
  }
  return body.access_token;
}

async function relayRequest(
  env: WorkerBindings,
  path: string,
  body: Record<string, unknown>,
  options: { fetcher?: typeof fetch; cache?: Cache | null } = {},
): Promise<boolean> {
  const config = relayConfig(env);
  if (!config.enabled) return false;
  const fetcher = options.fetcher ?? fetch;
  const cache = options.cache === undefined ? caches.default : options.cache;
  const token = await accessToken(config, fetcher, cache);
  const response = await fetcher(`${config.relayUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Push relay returned ${response.status}`);
  return true;
}

export async function registerPushDevice(
  env: WorkerBindings,
  device: RelayDevice,
  options?: { fetcher?: typeof fetch; cache?: Cache | null },
): Promise<boolean> {
  return relayRequest(
    env,
    "/push/register",
    {
      ...device,
      installationId: String(env.PUSH_INSTALLATION_ID ?? "").trim(),
    },
    options,
  );
}

export async function unregisterPushDevice(
  env: WorkerBindings,
  pushUuid: string,
  options?: { fetcher?: typeof fetch; cache?: Cache | null },
): Promise<boolean> {
  return relayRequest(
    env,
    `/push/delete/${encodeURIComponent(pushUuid)}`,
    {},
    options,
  );
}

export async function publishPushVaultChange(
  env: WorkerBindings,
  userId: string,
  organizationId: string | null,
  deviceIdentifier: string | null,
  revisionDate = Math.floor(Date.now() / 1000),
  options?: { fetcher?: typeof fetch; cache?: Cache | null },
): Promise<boolean> {
  return relayRequest(
    env,
    "/push/send",
    {
      userId: organizationId ? null : userId,
      organizationId,
      deviceId: null,
      identifier: deviceIdentifier,
      type: 5,
      payload: {
        userId,
        date: new Date(revisionDate * 1000).toISOString(),
      },
      clientType: null,
      installationId: null,
    },
    options,
  );
}

export async function pushDeviceRegistrationFromDatabase(
  env: WorkerBindings,
  userId: string,
  deviceIdentifier: string,
): Promise<boolean> {
  if (!getPushRelayStatus(env).enabled) return false;
  const { db } = await createDatabase(env.DB);
  try {
    const device = await db
      .selectFrom("devices")
      .select(["push_uuid", "push_token", "type"])
      .where("user_id", "=", userId)
      .where("device_identifier", "=", deviceIdentifier)
      .executeTakeFirst();
    if (!device?.push_uuid || !device.push_token) return false;
    const memberships = await db
      .selectFrom("org_members")
      .select("org_id")
      .where("user_id", "=", userId)
      .where("status", "=", "confirmed")
      .execute();
    return registerPushDevice(env, {
      deviceId: device.push_uuid,
      pushToken: device.push_token,
      userId,
      type: device.type,
      identifier: deviceIdentifier,
      organizationIds: memberships.map(({ org_id }) => org_id),
    });
  } finally {
    await db.destroy();
  }
}

export function logPushRelayFailure(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}
