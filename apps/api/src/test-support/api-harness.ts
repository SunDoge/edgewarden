import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { app } from "../index";

export interface ApiTestHarness {
  bindings: CloudflareBindings;
  database: D1Database;
  r2Values: Map<string, Uint8Array>;
  request: (
    path: string,
    init?: RequestInit,
    executionContext?: ExecutionContext,
  ) => Promise<Response>;
  json: <TBody>(
    path: string,
    body: TBody,
    init?: Omit<RequestInit, "body">,
  ) => Promise<Response>;
  authenticated: (accessToken: string) => ApiTestClient;
  dispose: () => Promise<void>;
}

export interface ApiTestClient {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  json: <TBody>(
    path: string,
    body: TBody,
    init?: Omit<RequestInit, "body">,
  ) => Promise<Response>;
}

/** Parse a response and include its body in the failure, instead of emitting an opaque status mismatch. */
export async function expectJson<T>(
  response: Response,
  expectedStatus = 200,
): Promise<T> {
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected HTTP ${expectedStatus}, received ${response.status}: ${text || "<empty body>"}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `Expected a JSON response, received: ${text || "<empty body>"}`,
      {
        cause: error,
      },
    );
  }
}

function jsonInit<TBody>(
  body: TBody,
  init: Omit<RequestInit, "body"> = {},
): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return {
    ...init,
    method: init.method ?? "POST",
    headers,
    body: JSON.stringify(body),
  };
}

async function applyMigrations(database: D1Database): Promise<void> {
  const directory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../migrations",
  );
  const migrations = readdirSync(directory)
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(resolve(directory, file), "utf8")
        .replace(/--.*$/gm, "")
        .trim(),
    }));
  for (const migration of migrations) {
    try {
      // Reuse Wrangler's migration parser so trigger bodies and quoted
      // semicolons behave exactly like they do during deployment.
      for (const statement of unstable_splitSqlQuery(migration.sql)) {
        if (statement.startsWith("PRAGMA foreign_keys")) continue;
        await database.prepare(statement).run();
      }
    } catch (error) {
      throw new Error(`Migration ${migration.file} failed`, {
        cause: error,
      });
    }
  }
}

export async function createApiTestHarness(secrets: {
  adminPassword: string;
  jwtSecret: string;
  dataEncryptionSecret: string;
}): Promise<ApiTestHarness> {
  const miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: "edgewarden-test",
          type: "worker",
          compatibilityDate: "2026-08-04",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents:
                  "export default { fetch() { return new Response('ok') } }",
              },
            },
          },
          env: {
            DB: { type: "d1", name: "DB" },
            ATTACHMENTS_KV: { type: "kv" },
          },
        },
      },
    ],
  });
  const database = await miniflare.getD1Database("DB");
  await applyMigrations(database);

  const r2Values = new Map<string, Uint8Array>();
  const rateLimiter = { limit: async () => ({ success: true }) };
  const realtime = {
    getByName: () => ({
      fetch: async () => new Response(null, { status: 204 }),
    }),
  };
  const bindings = {
    DB: database,
    ATTACHMENTS_KV: await miniflare.getKVNamespace("ATTACHMENTS_KV"),
    ATTACHMENTS_R2: {
      put: async (key: string, value: unknown) => {
        const bytes =
          value instanceof ReadableStream
            ? new Uint8Array(await new Response(value).arrayBuffer())
            : new Uint8Array(value as ArrayBuffer);
        r2Values.set(key, bytes);
      },
      get: async (key: string) => {
        const bytes = r2Values.get(key);
        return bytes
          ? {
              body: new Response(bytes).body,
              size: bytes.byteLength,
              httpMetadata: { contentType: "application/octet-stream" },
            }
          : null;
      },
      delete: async (key: string) => {
        r2Values.delete(key);
      },
    },
    ATTACHMENT_STORAGE: "r2",
    ADMIN_PASSWORD: secrets.adminPassword,
    SIGNUPS_ALLOWED: "true",
    INVITATIONS_ALLOWED: "true",
    JWT_SECRET: secrets.jwtSecret,
    DATA_ENCRYPTION_SECRET: secrets.dataEncryptionSecret,
    RL_IP: rateLimiter,
    RL_ACCOUNT: rateLimiter,
    REALTIME: realtime,
  } as unknown as CloudflareBindings;

  const request: ApiTestHarness["request"] = async (
    path,
    init = {},
    executionContext,
  ) => {
    if (executionContext) {
      return app.request(path, init, bindings, executionContext);
    }
    const backgroundTasks: Promise<unknown>[] = [];
    const testExecutionContext = {
      waitUntil(task: Promise<unknown>) {
        backgroundTasks.push(task);
      },
      passThroughOnException() {},
      props: {},
    } as ExecutionContext;
    const response = await app.request(
      path,
      init,
      bindings,
      testExecutionContext,
    );
    // Awaiting waitUntil work makes background side effects deterministic in tests.
    await Promise.all(backgroundTasks);
    return response;
  };
  const json: ApiTestHarness["json"] = (path, body, init) =>
    request(path, jsonInit(body, init));

  return {
    bindings,
    database,
    r2Values,
    request,
    json,
    authenticated: (accessToken) => {
      const withAuthorization = (init: RequestInit = {}): RequestInit => {
        const headers = new Headers(init.headers);
        headers.set("authorization", `Bearer ${accessToken}`);
        return { ...init, headers };
      };
      return {
        request: (path, init) => request(path, withAuthorization(init)),
        json: (path, body, init) =>
          request(path, withAuthorization(jsonInit(body, init))),
      };
    },
    dispose: () => miniflare.dispose(),
  };
}
