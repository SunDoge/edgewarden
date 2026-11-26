import { createDatabase } from "../middleware/db";
import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { WorkerBindings } from "../worker-bindings";
import { loadSystemSetting, saveSystemSetting } from "./system-settings";

type PushRegion = "US" | "EU";

export interface PushRelayStatus {
  enabled: boolean;
  region: PushRegion;
  installationIdConfigured: boolean;
  installationKeyConfigured: boolean;
  reason: "ready" | "missing_credentials" | "invalid_region";
  environmentOverrides: string[];
}

export interface StoredPushRelaySettings {
  region: PushRegion;
  installationId: string | null;
  installationKey: string | null;
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

export const PUSH_RELAY_SETTINGS_KEY = "system.push-relay.settings.v1";
export const DEFAULT_PUSH_RELAY_SETTINGS: StoredPushRelaySettings = {
  region: "US",
  installationId: null,
  installationKey: null,
};

function validateStoredSettings(value: unknown): StoredPushRelaySettings {
  if (!value || typeof value !== "object")
    throw new Error("Push relay settings are invalid");
  const input = value as Partial<StoredPushRelaySettings>;
  if (
    (input.region !== "US" && input.region !== "EU") ||
    (input.installationId !== null &&
      typeof input.installationId !== "string") ||
    (input.installationKey !== null &&
      typeof input.installationKey !== "string")
  )
    throw new Error("Push relay settings are invalid");
  return input as StoredPushRelaySettings;
}

export async function loadStoredPushRelaySettings(
  db: Kysely<DB>,
  secret: string,
): Promise<StoredPushRelaySettings> {
  return (
    (await loadSystemSetting(
      db,
      secret,
      PUSH_RELAY_SETTINGS_KEY,
      validateStoredSettings,
    )) ?? structuredClone(DEFAULT_PUSH_RELAY_SETTINGS)
  );
}

export async function saveStoredPushRelaySettings(
  db: Kysely<DB>,
  secret: string,
  settings: StoredPushRelaySettings,
): Promise<void> {
  await saveSystemSetting(
    db,
    secret,
    PUSH_RELAY_SETTINGS_KEY,
    validateStoredSettings(settings),
  );
}

function relayConfig(
  env: WorkerBindings,
  stored: StoredPushRelaySettings,
): PushRelayConfig {
  const environmentOverrides: string[] = [];
  const envValue = (name: string, value: string | undefined) => {
    const normalized = value?.trim();
    if (normalized) environmentOverrides.push(name);
    return normalized || undefined;
  };
  const requestedRegion = String(
    envValue("region", env.PUSH_REGION) ?? stored.region,
  )
    .trim()
    .toUpperCase();
  const validRegion = requestedRegion === "US" || requestedRegion === "EU";
  const region: PushRegion = requestedRegion === "EU" ? "EU" : "US";
  const installationId = String(
    envValue("installationId", env.PUSH_INSTALLATION_ID) ??
      stored.installationId ??
      "",
  ).trim();
  const installationKey = String(
    envValue("installationKey", env.PUSH_INSTALLATION_KEY) ??
      stored.installationKey ??
      "",
  ).trim();
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
    environmentOverrides,
    ...ENDPOINTS[region],
  };
}

export async function resolvePushRelayConfig(
  db: Kysely<DB>,
  env: WorkerBindings,
): Promise<PushRelayConfig> {
  let stored = structuredClone(DEFAULT_PUSH_RELAY_SETTINGS);
  try {
    stored = await loadStoredPushRelaySettings(db, env.DATA_ENCRYPTION_SECRET);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "push.settings.load_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return relayConfig(env, stored);
}

function statusFromConfig(config: PushRelayConfig): PushRelayStatus {
  const {
    enabled,
    region,
    installationIdConfigured,
    installationKeyConfigured,
    reason,
    environmentOverrides,
  } = config;
  return {
    enabled,
    region,
    installationIdConfigured,
    installationKeyConfigured,
    reason,
    environmentOverrides,
  };
}

/** Synchronous environment-only status retained for diagnostics and unit tests. */
export function getPushRelayStatus(env: WorkerBindings): PushRelayStatus {
  return statusFromConfig(relayConfig(env, DEFAULT_PUSH_RELAY_SETTINGS));
}

export async function resolvePushRelayStatus(
  db: Kysely<DB>,
  env: WorkerBindings,
): Promise<PushRelayStatus> {
  return statusFromConfig(await resolvePushRelayConfig(db, env));
}

async function requestRelayConfig(
  env: WorkerBindings,
): Promise<PushRelayConfig> {
  // Fully configured Worker secrets are the highest-priority compatibility
  // path and avoid a D1 read on every notification.
  if (env.PUSH_INSTALLATION_ID?.trim() && env.PUSH_INSTALLATION_KEY?.trim())
    return relayConfig(env, DEFAULT_PUSH_RELAY_SETTINGS);
  const { db } = await createDatabase(env.DB);
  try {
    return await resolvePushRelayConfig(db, env);
  } finally {
    await db.destroy();
  }
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

export async function testPushRelayConnection(
  db: Kysely<DB>,
  env: WorkerBindings,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const config = await resolvePushRelayConfig(db, env);
  if (!config.enabled) throw new Error("Push relay credentials are incomplete");
  await accessToken(config, fetcher, null);
}

async function relayRequest(
  env: WorkerBindings,
  path: string,
  body:
    | Record<string, unknown>
    | ((config: PushRelayConfig) => Record<string, unknown>),
  options: { fetcher?: typeof fetch; cache?: Cache | null } = {},
): Promise<boolean> {
  const config = await requestRelayConfig(env);
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
    body: JSON.stringify(typeof body === "function" ? body(config) : body),
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
    (config) => ({
      ...device,
      installationId: config.installationId,
    }),
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

/** Refreshes organization membership/keys on every device, including removed members. */
export async function publishPushOrganizationKeys(
  env: WorkerBindings,
  userId: string,
  options?: { fetcher?: typeof fetch; cache?: Cache | null },
): Promise<boolean> {
  return relayRequest(
    env,
    "/push/send",
    {
      userId,
      organizationId: null,
      deviceId: null,
      identifier: null,
      type: 6,
      payload: { userId, date: new Date().toISOString() },
      clientType: null,
      installationId: null,
    },
    options,
  );
}

/** Notifies the user's other native clients that a passwordless login needs review. */
export async function publishPushAuthRequest(
  env: WorkerBindings,
  userId: string,
  authRequestId: string,
  requestDeviceIdentifier: string,
  requestDevicePushId: string | null,
  options?: { fetcher?: typeof fetch; cache?: Cache | null },
): Promise<boolean> {
  return relayRequest(
    env,
    "/push/send",
    {
      userId,
      organizationId: null,
      // Bitwarden uses both values to identify the client that originated the
      // request. The relay can then exclude that installation while notifying
      // the account owner's other registered devices.
      deviceId: requestDevicePushId,
      identifier: requestDeviceIdentifier,
      type: 15,
      payload: { userId, id: authRequestId },
      clientType: null,
      installationId: null,
    },
    options,
  );
}

/** Notifies the requesting native client that its passwordless login was approved. */
export async function publishPushAuthRequestResponse(
  env: WorkerBindings,
  userId: string,
  authRequestId: string,
  responseDeviceIdentifier: string | null,
  responseDevicePushId: string | null,
  options?: { fetcher?: typeof fetch; cache?: Cache | null },
): Promise<boolean> {
  return relayRequest(
    env,
    "/push/send",
    {
      userId,
      organizationId: null,
      // Identify the approving installation so the relay can deliver the
      // response to the requesting device without echoing it to the approver.
      deviceId: responseDevicePushId,
      identifier: responseDeviceIdentifier,
      type: 16,
      payload: { userId, id: authRequestId },
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
