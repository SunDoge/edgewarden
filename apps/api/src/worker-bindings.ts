/**
 * Optional deployment configuration that Wrangler cannot infer from the base
 * config because users add these vars/secrets only when enabling a feature.
 * Platform bindings (D1, R2, Durable Objects, rate limits) remain generated in
 * CloudflareBindings and must not be duplicated here.
 */
export type WorkerBindings = CloudflareBindings & {
	ADMIN_PASSWORD?: string;
	CORS_ALLOWED_ORIGINS?: string;
	TURNSTILE_SECRET_KEY?: string;
	TURNSTILE_SITE_KEY?: string;
	WEBAUTHN_ALLOWED_ORIGINS?: string;
	WEBAUTHN_RP_ID?: string;
	WEBAUTHN_RP_NAME?: string;
	YUBICO_CLIENT_ID?: string;
	YUBICO_SECRET_KEY?: string;
};

export const OPTIONAL_WORKER_BINDING_NAMES = [
	"ADMIN_PASSWORD",
	"CORS_ALLOWED_ORIGINS",
	"TURNSTILE_SECRET_KEY",
	"TURNSTILE_SITE_KEY",
	"WEBAUTHN_ALLOWED_ORIGINS",
	"WEBAUTHN_RP_ID",
	"WEBAUTHN_RP_NAME",
	"YUBICO_CLIENT_ID",
	"YUBICO_SECRET_KEY",
] as const;
