import { app } from "../index";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_RUNTIME,
  isDemoRequestAllowed,
} from "./policy";
import {
  cleanupDemo,
  initializeDemo,
  requireDemoDeployment,
  type DemoBindings,
} from "./state";
export { VaultRealtime } from "../durable-objects/vault-realtime";

function denied(
  message = "This is a read-only Demo. Deploy your own vault to make changes.",
  // Bitwarden clients treat 403 as session revocation. A read-only policy
  // rejection is a business error, not an invalid login.
  status = 400,
): Response {
  return Response.json(
    { message, object: "error" },
    { status, headers: { "cache-control": "no-store" } },
  );
}
// Bound streamed bodies as well as Content-Length. Login needs only a few KiB.
async function boundedRequest(request: Request): Promise<Request> {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new RangeError("Demo request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}
export async function demoFetch(
  request: Request,
  env: DemoBindings,
  ctx: ExecutionContext,
): Promise<Response> {
  requireDemoDeployment(env);
  const path = new URL(request.url).pathname;
  // Assets bypass the API, not the allowlist. Never pass unknown API paths to SPA.
  const api =
    /^\/(?:api|identity|notifications)(?:\/|$)/.test(path) ||
    path === "/config";
  if (!api) {
    if (request.method !== "GET" && request.method !== "HEAD") return denied();
    return env.ASSETS.fetch(request);
  }
  if (
    !(
      await env.RL_ACCOUNT.limit({
        key: `demo:${request.headers.get("cf-connecting-ip") ?? "local"}`,
      })
    ).success
  )
    return denied("Demo rate limit reached. Please retry later.", 429);
  if (path === "/api/demo" && request.method === "GET")
    return Response.json(
      {
        enabled: true,
        readOnly: true,
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      },
      { headers: { "cache-control": "no-store" } },
    );
  // OPTIONS has no side effects and must reach the application's CORS middleware.
  if (
    request.method !== "OPTIONS" &&
    !isDemoRequestAllowed(request.method, path)
  )
    return denied();
  try {
    request = await boundedRequest(request);
  } catch (error) {
    if (error instanceof RangeError) return denied(error.message, 413);
    throw error;
  }
  if (path === "/identity/connect/token" && request.method === "POST") {
    const copy = request.clone();
    let grant: unknown;
    try {
      if (request.headers.get("content-type")?.includes("application/json")) {
        const body = (await copy.json()) as Record<string, unknown>;
        grant = body.grant_type;
      } else grant = (await copy.formData()).get("grant_type");
    } catch {
      return denied("Invalid token request", 400);
    }
    if (
      grant !== "password" &&
      grant !== "refresh_token" &&
      grant !== "send_access"
    )
      return denied();
  }
  await initializeDemo(env);
  return app.fetch(request, { ...env, [DEMO_RUNTIME]: true }, ctx);
}
export default {
  fetch: demoFetch,
  async scheduled(
    _controller: ScheduledController,
    env: DemoBindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(cleanupDemo(env));
  },
} satisfies ExportedHandler<DemoBindings>;
