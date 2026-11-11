import assert from "node:assert/strict";
import { afterAll, beforeAll, test, vi } from "vitest";
import {
  type ApiTestHarness,
  createApiTestHarness,
} from "../test-support/api-harness";

const EMAIL = "sync-observability@example.com";
const PASSWORD = "sync-observability-password-hash";
const RAY_ID = "sync-observability-test-ray";
let harness: ApiTestHarness;
let accessToken: string;

beforeAll(async () => {
  harness = await createApiTestHarness({
    adminPassword: "sync-observability-admin-password",
    jwtSecret: "sync-observability-jwt-secret-at-least-32-characters",
    dataEncryptionSecret:
      "sync-observability-data-secret-at-least-32-characters",
  });
  const registration = await harness.json("/api/edgewarden/accounts/register", {
    email: EMAIL,
    masterPasswordHash: PASSWORD,
    key: "encrypted-user-key-must-not-appear-in-logs",
    kdf: 0,
    kdfIterations: 600_000,
    adminPassword: "sync-observability-admin-password",
  });
  assert.equal(registration.status, 204, await registration.clone().text());

  const login = await harness.request("/identity/connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: EMAIL,
      password: PASSWORD,
    }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  accessToken = await login
    .json<{ access_token: string }>()
    .then((body) => body.access_token);
});

afterAll(async () => harness?.dispose());

test("emits queryable sync timings without vault or credential data", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const response = await harness.request("/api/sync?excludeDomains=true", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "cf-ray": RAY_ID,
      },
    });
    assert.equal(response.status, 200, await response.clone().text());

    const entry = log.mock.calls
      .map(
        ([message]) => JSON.parse(String(message)) as Record<string, unknown>,
      )
      .find((candidate) => candidate.event === "sync.completed");
    assert.ok(entry);
    assert.equal(entry.requestId, RAY_ID);
    assert.equal(entry.excludeDomains, true);
    assert.equal(entry.attempts, 1);
    assert.equal(typeof entry.durationMs, "number");
    assert.equal(typeof entry.stagesMs, "object");
    assert.deepEqual(entry.counts, {
      ciphers: 0,
      personalCiphers: 0,
      organizationCiphers: 0,
      folders: 0,
      organizations: 0,
      collections: 0,
      attachments: 0,
      sends: 0,
      accountCredentials: 0,
    });

    const serialized = JSON.stringify(entry);
    for (const secret of [EMAIL, PASSWORD, accessToken, "encrypted-user-key"]) {
      assert.equal(serialized.includes(secret), false);
    }
  } finally {
    log.mockRestore();
  }
});
