import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import type { HonoEnv } from "../../env";
import { factory } from "../../http/factory";
import {
  TestEmailSettingsSchema,
  UpdateEmailSettingsSchema,
} from "../../schemas/email-settings";
import { verifyAdminPassword } from "../../services/admin-auth";
import { safeWriteAuditEvent } from "../../services/audit";
import {
  loadStoredEmailSettings,
  resolveEmailSettings,
  saveStoredEmailSettings,
  sendTransactionalEmail,
  type StoredEmailSettings,
} from "../../services/email";
import { errorResponse } from "../../utils/response";

async function response(c: Context<HonoEnv>) {
  const settings = await resolveEmailSettings(c.get("db"), c.env);
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    activeProvider: settings.activeProvider,
    from: settings.from,
    replyTo: settings.replyTo,
    privacyMode: settings.privacyMode,
    resendApiKeyConfigured: Boolean(settings.resendApiKey),
    environmentOverrides: settings.environmentOverrides,
    object: "emailSettings" as const,
  };
}

export const getAdminEmailSettings = factory.createHandlers(async (c) =>
  c.json(await response(c)),
);

export const updateAdminEmailSettings = factory.createHandlers(
  vValidator("json", UpdateEmailSettingsSchema),
  async (c) => {
    const body = c.req.valid("json");
    const passwordError = await verifyAdminPassword(c, body.masterPasswordHash);
    if (passwordError) return passwordError;
    const existing = await loadStoredEmailSettings(
      c.get("db"),
      c.env.DATA_ENCRYPTION_SECRET,
    );
    const from = body.from.trim();
    const replyTo = body.replyTo?.trim() || null;
    if (body.enabled && !from)
      return errorResponse(
        "A sender address is required when email is enabled",
        400,
      );
    const settings: StoredEmailSettings = {
      enabled: body.enabled,
      provider: body.provider,
      from,
      replyTo,
      privacyMode: body.privacyMode,
      resendApiKey: body.clearResendApiKey
        ? null
        : body.resendApiKey?.trim() || existing.resendApiKey,
    };
    if (
      settings.enabled &&
      settings.provider === "resend" &&
      !settings.resendApiKey
    )
      return errorResponse("A Resend API key is required", 400);
    await saveStoredEmailSettings(
      c.get("db"),
      c.env.DATA_ENCRYPTION_SECRET,
      settings,
    );
    await safeWriteAuditEvent(c.get("db"), {
      actorUserId: c.get("user").id,
      action: "admin.email.settings",
      category: "admin",
      level: "warning",
      targetType: "config",
      metadata: {
        enabled: settings.enabled,
        provider: settings.provider,
        privacyMode: settings.privacyMode,
      },
    });
    return c.json(await response(c));
  },
);

export const testAdminEmailSettings = factory.createHandlers(
  vValidator("json", TestEmailSettingsSchema),
  async (c) => {
    const passwordError = await verifyAdminPassword(
      c,
      c.req.valid("json").masterPasswordHash,
    );
    if (passwordError) return passwordError;
    const settings = await resolveEmailSettings(c.get("db"), c.env);
    if (!settings.activeProvider)
      return errorResponse("Email is disabled or incomplete", 409);
    const result = await sendTransactionalEmail(c.env, settings, {
      to: c.get("user").email,
      subject: "Edgewarden test email",
      text: "Your Edgewarden transactional email configuration is working.",
      html: "<p>Your Edgewarden transactional email configuration is working.</p>",
      tag: "configuration-test",
    });
    return c.json({
      sent: true,
      provider: result?.provider,
      object: "emailTest",
    });
  },
);
