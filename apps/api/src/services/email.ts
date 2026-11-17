import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { WorkerBindings } from "../worker-bindings";
import { loadSystemSetting, saveSystemSetting } from "./system-settings";

export type EmailProvider = "auto" | "cloudflare" | "resend";
export type EmailPrivacyMode = "minimal" | "detailed";
export interface StoredEmailSettings {
  enabled: boolean;
  provider: EmailProvider;
  from: string;
  replyTo: string | null;
  privacyMode: EmailPrivacyMode;
  resendApiKey: string | null;
}
export interface RuntimeEmailSettings extends StoredEmailSettings {
  activeProvider: Exclude<EmailProvider, "auto"> | null;
  environmentOverrides: string[];
}
export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  tag: string;
}
export interface EmailDeliveryResult {
  provider: Exclude<EmailProvider, "auto">;
  messageId: string | null;
}

export const EMAIL_SETTINGS_KEY = "system.email.settings.v1";
export const DEFAULT_EMAIL_SETTINGS: StoredEmailSettings = {
  enabled: false,
  provider: "auto",
  from: "",
  replyTo: null,
  privacyMode: "minimal",
  resendApiKey: null,
};

function validateSettings(value: unknown): StoredEmailSettings {
  if (!value || typeof value !== "object")
    throw new Error("Email settings are invalid");
  const input = value as Partial<StoredEmailSettings>;
  if (
    typeof input.enabled !== "boolean" ||
    !["auto", "cloudflare", "resend"].includes(String(input.provider)) ||
    typeof input.from !== "string" ||
    !["minimal", "detailed"].includes(String(input.privacyMode)) ||
    (input.replyTo !== null && typeof input.replyTo !== "string") ||
    (input.resendApiKey !== null && typeof input.resendApiKey !== "string")
  )
    throw new Error("Email settings are invalid");
  return input as StoredEmailSettings;
}

export async function loadStoredEmailSettings(db: Kysely<DB>, secret: string) {
  return (
    (await loadSystemSetting(
      db,
      secret,
      EMAIL_SETTINGS_KEY,
      validateSettings,
    )) ?? structuredClone(DEFAULT_EMAIL_SETTINGS)
  );
}

export async function saveStoredEmailSettings(
  db: Kysely<DB>,
  secret: string,
  settings: StoredEmailSettings,
) {
  await saveSystemSetting(
    db,
    secret,
    EMAIL_SETTINGS_KEY,
    validateSettings(settings),
  );
}

export async function resolveEmailSettings(
  db: Kysely<DB>,
  env: WorkerBindings,
): Promise<RuntimeEmailSettings> {
  let stored = structuredClone(DEFAULT_EMAIL_SETTINGS);
  try {
    stored = await loadStoredEmailSettings(db, env.DATA_ENCRYPTION_SECRET);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "email.settings.load_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const environmentOverrides: string[] = [];
  const envValue = (name: string, value: string | undefined) => {
    const normalized = value?.trim();
    if (normalized) environmentOverrides.push(name);
    return normalized || undefined;
  };
  const from = envValue("from", env.EMAIL_FROM) ?? stored.from;
  const providerValue = envValue("provider", env.EMAIL_PROVIDER);
  const privacyValue = envValue("privacyMode", env.EMAIL_PRIVACY_MODE);
  const provider = (
    ["auto", "cloudflare", "resend"].includes(providerValue ?? "")
      ? providerValue
      : stored.provider
  ) as EmailProvider;
  const privacyMode = (
    ["minimal", "detailed"].includes(privacyValue ?? "")
      ? privacyValue
      : stored.privacyMode
  ) as EmailPrivacyMode;
  const resendApiKey =
    envValue("resendApiKey", env.RESEND_API_KEY) ?? stored.resendApiKey;
  const resolved: StoredEmailSettings = {
    ...stored,
    enabled: env.EMAIL_FROM?.trim() ? true : stored.enabled,
    provider,
    from,
    replyTo: envValue("replyTo", env.EMAIL_REPLY_TO) ?? stored.replyTo,
    privacyMode,
    resendApiKey,
  };
  const activeProvider =
    !resolved.enabled || !resolved.from.trim()
      ? null
      : provider === "cloudflare"
        ? "cloudflare"
        : provider === "resend"
          ? resendApiKey
            ? "resend"
            : null
          : env.EMAIL
            ? "cloudflare"
            : resendApiKey
              ? "resend"
              : null;
  return { ...resolved, activeProvider, environmentOverrides };
}

async function sendWithResend(
  settings: RuntimeEmailSettings,
  message: TransactionalEmail,
  fetchImpl: typeof fetch,
): Promise<EmailDeliveryResult> {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.resendApiKey}`,
      "content-type": "application/json",
      "user-agent": "Edgewarden transactional email",
    },
    body: JSON.stringify({
      from: settings.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
      tags: [{ name: "category", value: message.tag }],
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    id?: string;
    message?: string;
  } | null;
  if (!response.ok)
    throw new Error(
      `Resend email failed (${response.status}): ${body?.message || response.statusText}`,
    );
  return { provider: "resend", messageId: body?.id ?? null };
}

export async function sendTransactionalEmail(
  env: WorkerBindings,
  settings: RuntimeEmailSettings,
  message: TransactionalEmail,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailDeliveryResult | null> {
  if (!settings.activeProvider) return null;
  if (settings.activeProvider === "resend")
    return sendWithResend(settings, message, fetchImpl);
  const result = await env.EMAIL.send({
    from: settings.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
  });
  return {
    provider: "cloudflare",
    messageId:
      result && typeof result === "object" && "messageId" in result
        ? String(result.messageId)
        : null,
  };
}

export function scheduleTransactionalEmail(
  ctx: { waitUntil(promise: Promise<unknown>): void },
  db: Kysely<DB>,
  env: WorkerBindings,
  createMessage: (settings: RuntimeEmailSettings) => TransactionalEmail,
): void {
  ctx.waitUntil(
    resolveEmailSettings(db, env)
      .then(async (settings) => {
        if (!settings.activeProvider) return;
        const message = createMessage(settings);
        const result = await sendTransactionalEmail(env, settings, message);
        console.log(
          JSON.stringify({
            event: "email.sent",
            provider: result?.provider,
            messageId: result?.messageId,
            tag: message.tag,
          }),
        );
      })
      .catch((error) => {
        console.error(
          JSON.stringify({
            event: "email.failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }),
  );
}

export function escapeEmailHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(
    /[&<>"']/g,
    (character) => replacements[character] ?? character,
  );
}
