import assert from "node:assert/strict";
import { afterAll, beforeAll, test, vi } from "vitest";
import {
  type ApiTestHarness,
  createApiTestHarness,
} from "../test-support/api-harness";

const EMAIL = "refresh-observability@example.com";
const PASSWORD = "refresh-observability-password-hash";
const RAY_ID = "refresh-observability-test-ray";
let harness: ApiTestHarness;
let refreshToken: string;

beforeAll(async () => {
  harness = await createApiTestHarness({
    adminPassword: "refresh-observability-admin-password",
    jwtSecret: "refresh-observability-jwt-secret-at-least-32-characters",
    dataEncryptionSecret:
      "refresh-observability-data-secret-at-least-32-characters",
  });
  const registration = await harness.json("/api/edgewarden/accounts/register", {
    email: EMAIL,
    masterPasswordHash: PASSWORD,
    key: "encrypted-user-key",
    kdf: 0,
    kdfIterations: 600_000,
    adminPassword: "refresh-observability-admin-password",
  });
  assert.equal(registration.status, 204, await registration.clone().text());

  const login = await harness.request("/identity/connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: EMAIL,
      password: PASSWORD,
      client_id: "browser",
    }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  refreshToken = await login
    .json<{ refresh_token: string }>()
    .then((body) => body.refresh_token);
});

afterAll(async () => harness?.dispose());

test("logs refresh outcomes without credentials or account identifiers", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const refresh = (token: string) =>
      harness.request("/identity/connect/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "cf-ray": RAY_ID,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token,
          client_id: "browser",
        }),
      });

    const succeeded = await refresh(refreshToken);
    assert.equal(succeeded.status, 200, await succeeded.clone().text());
    const rejected = await refresh("invalid-refresh-token");
    assert.equal(rejected.status, 400);

    const entries = [...log.mock.calls, ...warn.mock.calls]
      .map(
        ([message]) => JSON.parse(String(message)) as Record<string, unknown>,
      )
      .filter((entry) => entry.event === "auth.refresh.completed");
    assert.deepEqual(entries.map((entry) => entry.outcome).sort(), [
      "rejected",
      "succeeded",
    ]);
    for (const entry of entries) {
      assert.equal(entry.requestId, RAY_ID);
      assert.equal(entry.clientId, "browser");
      assert.equal(entry.tokenSource, "body");
      assert.equal(typeof entry.durationMs, "number");
      const serialized = JSON.stringify(entry);
      for (const secret of [
        EMAIL,
        PASSWORD,
        refreshToken,
        "invalid-refresh-token",
      ]) {
        assert.equal(serialized.includes(secret), false);
      }
    }
    assert.equal(
      entries.find((entry) => entry.outcome === "rejected")?.reason,
      "invalid_refresh_token",
    );
  } finally {
    log.mockRestore();
    warn.mockRestore();
  }
});
