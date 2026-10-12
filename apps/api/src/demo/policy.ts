// Internal capability: production cannot enable Demo policy with a string var.
export const DEMO_RUNTIME = Symbol("edgewarden-readonly-demo");
export const DEMO_EMAIL = "demo@edgewarden.example";
// Deliberately PUBLIC credentials for synthetic data, never a deployment secret.
export const DEMO_PASSWORD = "Edgewarden-Demo-2026!";
export const DEMO_USER_ID = "de000000-0000-4000-8000-000000000001";
export const DEMO_MARKER = "demo.readonly.v1";

export function isDemoRuntime(env: object): boolean {
  return Reflect.get(env, DEMO_RUNTIME) === true;
}

// Explicit allowlist: some GETs issue upload tokens. New routes fail closed.
const reads = [
  /^\/(?:api\/)?config$/,
  /^\/api\/(?:health|version|sync|collections|policies)$/,
  /^\/api\/accounts\/(?:profile|keys|revision-date|organizations)$/,
  /^\/api\/ciphers(?:\/[\da-f-]+(?:\/details)?)?$/,
  /^\/api\/folders(?:\/[\da-f-]+)?$/,
  /^\/api\/organizations(?:\/[\da-f-]+(?:\/(?:collections|public-key))?)?$/,
  /^\/api\/users\/[\da-f-]+\/public-key$/,
  /^\/api\/settings\/domains$/,
  /^\/api\/sends(?:\/[\da-f-]+)?$/,
  /^\/api\/devices\/knowndevice$/,
  /^\/api\/auth-requests\/pending$/,
  /^\/api\/two-factor$/,
  /^\/(?:api\/)?notifications\/hub$/,
];
const posts = new Set([
  "/identity/accounts/prelogin",
  "/identity/accounts/prelogin/password",
  "/identity/connect/token",
  "/identity/connect/revocation",
  "/api/accounts/verify-password",
  "/api/notifications/token",
  "/notifications/hub/negotiate",
  "/api/sends/access",
]);
export function isDemoRequestAllowed(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD")
    return reads.some((pattern) => pattern.test(path));
  return method === "POST" && posts.has(path);
}
