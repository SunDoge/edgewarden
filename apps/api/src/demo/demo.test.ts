import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import {
  createApiTestHarness,
  type ApiTestHarness,
} from "../test-support/api-harness";
import { demoFetch } from "./index";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_MARKER,
  isDemoRequestAllowed,
} from "./policy";
import { cleanupDemo, initializeDemo, type DemoBindings } from "./state";
import { pbkdf2Sync } from "node:crypto";
import {
  DEMO_ENGLISH_MARKER,
  DEMO_ENGLISH_PATCHES,
  DEMO_ENGLISH_REVISION,
} from "./english-content";

describe("read-only Demo", () => {
  let harness: ApiTestHarness;
  let env: DemoBindings;
  beforeEach(async () => {
    harness = await createApiTestHarness({
      adminPassword: "test-bootstrap",
      jwtSecret: "j".repeat(64),
      dataEncryptionSecret: "d".repeat(64),
    });
    env = { ...harness.bindings, DEMO_MODE: "readonly" };
  });
  afterEach(async () => {
    await harness.dispose();
    vi.restoreAllMocks();
  });
  async function request(path: string, init?: RequestInit) {
    const pending: Promise<unknown>[] = [];
    const response = await demoFetch(
      new Request(`https://demo.example${path}`, init),
      env,
      {
        props: {},
        exports: {},
        tracing: {},
        waitUntil(task: Promise<unknown>) {
          pending.push(task);
        },
        passThroughOnException() {},
      } as ExecutionContext,
    );
    await Promise.all(pending);
    return response;
  }
  async function snapshot() {
    return Promise.all(
      [
        "users",
        "ciphers",
        "folders",
        "organizations",
        "org_members",
        "collections",
        "sends",
      ].map((table) =>
        env.DB.prepare(`SELECT * FROM ${table}`)
          .all()
          .then((result) => result.results),
      ),
    );
  }
  async function restoreChineseSample() {
    await initializeDemo(env);
    await env.DB.batch([
      ...DEMO_ENGLISH_PATCHES.map((patch) =>
        env.DB.prepare(
          `UPDATE "${patch.table}" SET ${Object.keys(patch.before)
            .map((field) => `"${field}" = ?`)
            .join(",")}, updated_at = 1791590400 WHERE id = ?`,
        ).bind(...Object.values(patch.before), patch.id),
      ),
      env.DB.prepare("UPDATE user_revisions SET revision_date = 1791590400"),
      env.DB.prepare("DELETE FROM config WHERE key = ?").bind(
        DEMO_ENGLISH_MARKER,
      ),
    ]);
  }
  it("upgrades Chinese samples atomically, preserving keys and remaining idempotent", async () => {
    await initializeDemo(env);
    const english = await snapshot();
    await restoreChineseSample();
    await Promise.all([initializeDemo(env), initializeDemo(env)]);
    expect(await snapshot()).toEqual(english);
    expect(
      await env.DB.prepare("SELECT revision_date FROM user_revisions").first(
        "revision_date",
      ),
    ).toBe(DEMO_ENGLISH_REVISION);
    await initializeDemo(env);
    expect(await snapshot()).toEqual(english);
  });
  it("does not partially overwrite unexpected demo content", async () => {
    await restoreChineseSample();
    await env.DB.prepare(
      "UPDATE organizations SET name = 'Customized sample'",
    ).run();
    const before = await snapshot();
    await expect(initializeDemo(env)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect(
      await env.DB.prepare("SELECT value FROM config WHERE key = ?")
        .bind(DEMO_ENGLISH_MARKER)
        .first(),
    ).toBeNull();
  });
  it("seeds once, concurrently, without granting admin or enabling registration", async () => {
    await Promise.all([initializeDemo(env), initializeDemo(env)]);
    const before = await snapshot();
    await initializeDemo(env);
    expect(await snapshot()).toEqual(before);
    expect(
      await env.DB.prepare("SELECT email,role FROM users").first(),
    ).toEqual({ email: DEMO_EMAIL, role: "user" });
    expect(await (await request("/api/config")).json()).toMatchObject({
      registration: { signupsAllowed: false, bootstrapRequired: false },
    });
    expect(await (await harness.request("/api/demo")).json()).toEqual({
      enabled: false,
    });
  });
  it("refuses an existing vault or missing mode without changing data", async () => {
    await expect(
      initializeDemo({ ...env, DEMO_MODE: undefined }),
    ).rejects.toThrow("required");
    await initializeDemo(env);
    await env.DB.prepare("DELETE FROM config WHERE key = ?")
      .bind(DEMO_MARKER)
      .run();
    const before = await snapshot();
    await expect(initializeDemo(env)).rejects.toThrow("existing vault");
    expect(await snapshot()).toEqual(before);
  });
  it("rejects every registered non-allowlisted API route, including GET upload capabilities", async () => {
    await initializeDemo(env);
    const before = await snapshot();
    let count = 0;
    for (const route of app.routes) {
      if (
        route.method === "ALL" ||
        !/^\/(api|identity|notifications)\//.test(route.path)
      )
        continue;
      const path = route.path.replace(
        /:[^/]+/g,
        "de000000-0000-4000-8000-000000000003",
      );
      if (isDemoRequestAllowed(route.method, path) || path === "/api/demo")
        continue;
      expect(
        (await request(path, { method: route.method })).status,
        route.method + " " + path,
      ).toBe(400);
      count++;
    }
    expect(count).toBeGreaterThan(50);
    for (const path of [
      "/api/future-feature",
      "/api/ciphers/id/attachment/id/renew",
      "/api/devices",
      "/api/ciphers%2Fid",
    ]) {
      expect((await request(path)).status).toBe(400);
    }
    expect(await snapshot()).toEqual(before);
  });
  it("logs in, syncs, refreshes, and rejects authenticated writes", async () => {
    const master = pbkdf2Sync(DEMO_PASSWORD, DEMO_EMAIL, 600000, 32, "sha256");
    const hash = pbkdf2Sync(master, DEMO_PASSWORD, 1, 32, "sha256").toString(
      "base64",
    );
    const login = await request("/identity/connect/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "password",
        username: DEMO_EMAIL,
        password: hash,
        scope: "api offline_access",
        client_id: "cli",
        deviceType: "8",
        deviceIdentifier: crypto.randomUUID(),
        deviceName: "demo-test",
      }),
    });
    expect(login.status, await login.clone().text()).toBe(200);
    const tokens = (await login.json()) as {
      access_token: string;
      refresh_token: string;
    };
    const headers = { authorization: `Bearer ${tokens.access_token}` };
    const sync = await request("/api/sync", { headers });
    expect(sync.status).toBe(200);
    expect(await sync.json()).toMatchObject({
      ciphers: expect.any(Array),
      profile: { email: DEMO_EMAIL },
    });
    const before = await snapshot();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        (
          await request("/api/ciphers/de000000-0000-4000-8000-000000000003", {
            method,
            headers,
          })
        ).status,
      ).toBe(400);
    }
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await request("/identity/connect/token", {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
          }),
        })
      ).status,
    ).toBe(200);
    await cleanupDemo(env, Date.now() + 2 * 86400000);
    expect(await snapshot()).toEqual(before);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM refresh_tokens",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM devices").first(),
    ).toEqual({ count: 0 });
  });
  it("rejects unsupported grants and oversized streamed login bodies", async () => {
    expect(
      (
        await request("/identity/connect/token", {
          method: "POST",
          body: new URLSearchParams({ grant_type: "client_credentials" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/identity/connect/token", {
          method: "POST",
          body: "x".repeat(32769),
        })
      ).status,
    ).toBe(413);
  });
  it("rate limits before touching D1, and serves static pages without API writes", async () => {
    vi.spyOn(env.RL_ACCOUNT, "limit").mockResolvedValue({ success: false });
    expect((await request("/api/sync")).status).toBe(429);
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM users").first(),
    ).toEqual({ count: 0 });
    const fetchAsset = vi.fn().mockResolvedValue(new Response("static demo"));
    env.ASSETS = { fetch: fetchAsset } as unknown as Fetcher;
    expect(await (await request("/login")).text()).toBe("static demo");
    expect(fetchAsset).toHaveBeenCalledOnce();
    expect((await request("/login", { method: "POST" })).status).toBe(400);
    expect(fetchAsset).toHaveBeenCalledOnce();
  });
});
