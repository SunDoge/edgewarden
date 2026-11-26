import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import type { HonoEnv } from "../../env";
import { factory } from "../../http/factory";
import {
  TestPushRelaySettingsSchema,
  UpdatePushRelaySettingsSchema,
} from "../../schemas/push-relay-settings";
import { verifyAdminPassword } from "../../services/admin-auth";
import { safeWriteAuditEvent } from "../../services/audit";
import {
  loadStoredPushRelaySettings,
  PUSH_RELAY_SETTINGS_KEY,
  resolvePushRelayStatus,
  saveStoredPushRelaySettings,
  testPushRelayConnection,
} from "../../services/push-relay";
import { errorResponse } from "../../utils/response";

async function response(c: Context<HonoEnv>) {
  return {
    ...(await resolvePushRelayStatus(c.get("db"), c.env)),
    object: "pushRelaySettings" as const,
  };
}

export const getAdminPushRelaySettings = factory.createHandlers(async (c) =>
  c.json(await response(c)),
);

export const updateAdminPushRelaySettings = factory.createHandlers(
  vValidator("json", UpdatePushRelaySettingsSchema),
  async (c) => {
    const body = c.req.valid("json");
    const passwordError = await verifyAdminPassword(c, body.masterPasswordHash);
    if (passwordError) return passwordError;
    const existing = await loadStoredPushRelaySettings(
      c.get("db"),
      c.env.DATA_ENCRYPTION_SECRET,
    );
    const settings = {
      region: body.region,
      installationId: body.clearInstallationId
        ? null
        : body.installationId?.trim() || existing.installationId,
      installationKey: body.clearInstallationKey
        ? null
        : body.installationKey?.trim() || existing.installationKey,
    };
    if (Boolean(settings.installationId) !== Boolean(settings.installationKey))
      return errorResponse(
        "Installation ID and installation key must be configured together",
        400,
      );
    await saveStoredPushRelaySettings(
      c.get("db"),
      c.env.DATA_ENCRYPTION_SECRET,
      settings,
    );
    await safeWriteAuditEvent(c.get("db"), {
      actorUserId: c.get("user").id,
      action: "admin.push-relay.settings",
      category: "admin",
      level: "warning",
      targetType: "config",
      targetId: PUSH_RELAY_SETTINGS_KEY,
      metadata: {
        region: settings.region,
        configured: Boolean(
          settings.installationId && settings.installationKey,
        ),
      },
    });
    return c.json(await response(c));
  },
);

export const testAdminPushRelaySettings = factory.createHandlers(
  vValidator("json", TestPushRelaySettingsSchema),
  async (c) => {
    const passwordError = await verifyAdminPassword(
      c,
      c.req.valid("json").masterPasswordHash,
    );
    if (passwordError) return passwordError;
    try {
      await testPushRelayConnection(c.get("db"), c.env);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : "Push relay test failed",
        409,
      );
    }
    return c.json({ connected: true, object: "pushRelayTest" as const });
  },
);
