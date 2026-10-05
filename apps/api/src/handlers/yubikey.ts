import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import { sql } from "kysely";
import type { HonoEnv } from "../env";
import { factory } from "../http/factory";
import {
  DeleteYubicoKeysSchema,
  SaveYubicoConfigSchema,
  SaveYubicoKeysSchema,
  SecretVerificationSchema,
} from "../schemas/two-factor";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import { invalidateUserCache, verifyPassword } from "../services/auth";
import { encryptCredential } from "../services/credential-protection";
import {
  conditionalRefreshTokenDeletionQuery,
  conditionalUserRevisionQuery,
  conditionalYubikeyUpdateQuery,
} from "../services/db/batch";
import {
  loadYubicoCredentials,
  prepareYubicoCredentialsUpdate,
  YUBICO_CONFIG_KEY,
} from "../services/yubico-config";
import {
  yubiKeyDetails,
  yubiKeyReadResponse,
  yubiKeyUpdateResponse,
} from "../services/two-factor-presentation";
import { errorResponse } from "../utils/response";
import {
  createTwoFactorProviderToken,
  verifyTwoFactorProviderToken,
} from "../utils/jwt";
import { now } from "../utils/time";
import {
  parseYubikeyConfig,
  serializeYubikeyConfig,
  verifyYubicoOtp,
  yubicoPublicId,
} from "../utils/yubico";

const YUBIKEY_PROVIDER = 3;

function recoveryCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
}

async function verified(c: Context<HonoEnv>, hash: string): Promise<boolean> {
  const user = c.get("user");
  return verifyPassword(hash, user.master_password_hash, user.email);
}

async function hasValidUserVerificationToken(
  c: Context<HonoEnv>,
  token: string,
): Promise<boolean> {
  const claims = await verifyTwoFactorProviderToken(token, c.env.JWT_SECRET);
  const user = c.get("user");
  return Boolean(
    claims &&
      claims.sub === user.id &&
      claims.provider === YUBIKEY_PROVIDER &&
      claims.sstamp === user.security_stamp,
  );
}

async function settingsDetails(c: Context<HonoEnv>) {
  const user = c.get("user");
  const yubikey = parseYubikeyConfig(user.yubikey_config);
  return yubiKeyDetails(yubikey.keys, yubikey.nfc, {
    configured: Boolean(await loadYubicoCredentials(c.get("db"), c.env)),
    canManageConfig: user.role === "admin",
  });
}

export const getYubikeySettings = factory.createHandlers(
  vValidator("json", SecretVerificationSchema),
  async (c) => {
    if (!(await verified(c, c.req.valid("json").masterPasswordHash)))
      return errorResponse("Master password verification failed", 400);
    const user = c.get("user");
    return c.json(
      yubiKeyReadResponse(
        await settingsDetails(c),
        await createTwoFactorProviderToken(
          user.id,
          YUBIKEY_PROVIDER,
          user.security_stamp,
          c.env.JWT_SECRET,
        ),
      ),
    );
  },
);

export const saveYubikeys = factory.createHandlers(
  vValidator("json", SaveYubicoKeysSchema),
  async (c) => {
    const body = c.req.valid("json");
    if (!(await hasValidUserVerificationToken(c, body.userVerificationToken)))
      return errorResponse("User verification failed.", 400);
    const credentials = await loadYubicoCredentials(c.get("db"), c.env);
    if (!credentials)
      return errorResponse(
        "Yubico validation credentials are not configured",
        409,
      );
    const publicIds: string[] = [];
    for (const otp of [
      body.key1,
      body.key2,
      body.key3,
      body.key4,
      body.key5,
    ].filter((value): value is string => Boolean(value))) {
      const publicId = yubicoPublicId(otp);
      if (!publicId || !(await verifyYubicoOtp(otp, credentials)))
        return errorResponse("Invalid YubiKey OTP", 400);
      if (publicIds.includes(publicId))
        return errorResponse("Duplicate YubiKey", 400);
      publicIds.push(publicId);
    }
    const user = c.get("user");
    const db = c.get("db");
    const ts = now();
    const securityStamp = crypto.randomUUID();
    const encryptedRecoveryCode =
      user.totp_recovery_code ??
      (await encryptCredential(
        recoveryCode(),
        c.env.DATA_ENCRYPTION_SECRET,
        "totp-recovery",
      ));
    const [changed] = await c.get("dbDialect").batch([
      conditionalYubikeyUpdateQuery(
        db,
        user.id,
        user.security_stamp,
        user.yubikey_config,
        serializeYubikeyConfig({ keys: publicIds, nfc: body.nfc }),
        encryptedRecoveryCode,
        securityStamp,
        ts,
      ),
      conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
      conditionalUserRevisionQuery(db, user.id, securityStamp, ts),
      auditEventInsertQuery(
        db,
        {
          actorUserId: user.id,
          action: "account.two_factor.yubikey.enable",
          category: "auth",
          targetType: "user",
          targetId: user.id,
          metadata: {
            ...auditRequestMetadata(c.req.raw),
            size: publicIds.length,
          },
        },
        sql<boolean>`EXISTS (
						SELECT 1 FROM users
						WHERE id = ${user.id} AND security_stamp = ${securityStamp}
					)`,
        ts,
      ),
    ]);
    if (changed.numAffectedRows !== 1n)
      return errorResponse("YubiKey settings changed by another request", 409);
    invalidateUserCache(user.id);
    const updated = await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    c.set("user", updated);
    return c.json(yubiKeyUpdateResponse(await settingsDetails(c)));
  },
);

export const disableYubikeys = factory.createHandlers(
  vValidator("json", DeleteYubicoKeysSchema),
  async (c) => {
    const body = c.req.valid("json");
    if (!(await hasValidUserVerificationToken(c, body.userVerificationToken)))
      return errorResponse("User verification failed.", 400);
    const user = c.get("user");
    const db = c.get("db");
    if (parseYubikeyConfig(user.yubikey_config).keys.length === 0)
      return new Response(null, { status: 204 });
    const ts = now();
    const securityStamp = crypto.randomUUID();
    const [updated] = await c.get("dbDialect").batch([
      db
        .updateTable("users")
        .set({
          yubikey_config: serializeYubikeyConfig({ keys: [], nfc: false }),
          security_stamp: securityStamp,
          updated_at: ts,
        })
        .where("id", "=", user.id)
        .where("yubikey_config", "=", user.yubikey_config),
      conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
      conditionalUserRevisionQuery(db, user.id, securityStamp, ts),
      auditEventInsertQuery(
        db,
        {
          actorUserId: user.id,
          action: "account.two_factor.yubikey.disable",
          category: "auth",
          targetType: "user",
          targetId: user.id,
          metadata: auditRequestMetadata(c.req.raw),
        },
        sql<boolean>`EXISTS (
					SELECT 1 FROM users
					WHERE id = ${user.id} AND security_stamp = ${securityStamp}
				)`,
        ts,
      ),
    ]);
    if (updated.numAffectedRows !== 1n)
      return errorResponse("YubiKey settings changed by another request", 409);
    invalidateUserCache(user.id);
    return new Response(null, { status: 204 });
  },
);

export const saveYubicoConfig = factory.createHandlers(
  vValidator("json", SaveYubicoConfigSchema),
  async (c) => {
    const body = c.req.valid("json");
    if (!(await verified(c, body.masterPasswordHash)))
      return errorResponse("Master password verification failed", 400);
    try {
      atob(body.secretKey);
    } catch {
      return errorResponse("Yubico secret key must be valid base64", 400);
    }
    const db = c.get("db");
    const prepared = await prepareYubicoCredentialsUpdate(
      db,
      c.env.DATA_ENCRYPTION_SECRET,
      { clientId: body.clientId, secretKey: body.secretKey },
    );
    await c.get("dbDialect").batch([
      prepared.query,
      auditEventInsertQuery(
        db,
        {
          actorUserId: c.get("user").id,
          action: "admin.yubico.config",
          category: "admin",
          level: "warning",
          targetType: "config",
          targetId: YUBICO_CONFIG_KEY,
          metadata: auditRequestMetadata(c.req.raw),
        },
        sql<boolean>`EXISTS (
					SELECT 1 FROM config
					WHERE key = ${YUBICO_CONFIG_KEY} AND value = ${prepared.value}
				)`,
      ),
    ]);
    return c.json({ configured: true, object: "yubicoConfig" });
  },
);
