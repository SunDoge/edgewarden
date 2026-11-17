/**
 * Optional deployment configuration that Wrangler cannot infer from the base
 * config because users add these vars/secrets only when enabling a feature.
 * Platform bindings (D1, R2, Durable Objects, rate limits) remain generated in
 * CloudflareBindings and must not be duplicated here.
 */
import type { DEMO_RUNTIME } from "./demo/policy";

type OptionalWorkerBindings = {
  ADMIN_PASSWORD?: string;
  CORS_ALLOWED_ORIGINS?: string;
  EMAIL_FROM?: string;
  EMAIL_PRIVACY_MODE?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_REPLY_TO?: string;
  PUSH_INSTALLATION_ID?: string;
  PUSH_INSTALLATION_KEY?: string;
  PUSH_REGION?: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  WEBAUTHN_ALLOWED_ORIGINS?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_RP_NAME?: string;
  YUBICO_CLIENT_ID?: string;
  YUBICO_SECRET_KEY?: string;
};

export type WorkerBindings = Omit<
  CloudflareBindings,
  keyof OptionalWorkerBindings
> &
  OptionalWorkerBindings & { [DEMO_RUNTIME]?: true };

export const OPTIONAL_WORKER_BINDING_NAMES = [
  "ADMIN_PASSWORD",
  "CORS_ALLOWED_ORIGINS",
  "EMAIL_FROM",
  "EMAIL_PRIVACY_MODE",
  "EMAIL_PROVIDER",
  "EMAIL_REPLY_TO",
  "PUSH_INSTALLATION_ID",
  "PUSH_INSTALLATION_KEY",
  "PUSH_REGION",
  "RESEND_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_SITE_KEY",
  "WEBAUTHN_ALLOWED_ORIGINS",
  "WEBAUTHN_RP_ID",
  "WEBAUTHN_RP_NAME",
  "YUBICO_CLIENT_ID",
  "YUBICO_SECRET_KEY",
] as const;
