import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import { sql } from "kysely";
import type { HonoEnv } from "../env";
import { factory } from "../http/factory";
import {
  EmergencyAccessConfirmSchema,
  EmergencyAccessInviteSchema,
  EmergencyAccessPasswordSchema,
  EmergencyAccessUpdateSchema,
  emergencyAccessType,
} from "../schemas/emergency-access";
import { safeWriteAuditEvent } from "../services/audit";
import { hashPasswordServer, invalidateUserCache } from "../services/auth";
import { cipherToResponse } from "../services/ciphers/presentation";
import { revisionQuery } from "../services/db/batch";
import { emergencyAccessEmail } from "../services/emergency-access-email";
import { scheduleTransactionalEmail } from "../services/email";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";

const Status = {
  Accepted: 1,
  Confirmed: 2,
  Initiated: 3,
  Approved: 4,
} as const;

type EmergencyRow = {
  id: string;
  grantor_id: string;
  grantee_id: string;
  key_encrypted: string | null;
  type: number;
  status: number;
  wait_time_days: number;
  recovery_initiated_at: number | null;
  created_at: number;
  updated_at: number;
};

async function approveExpired(
  db: Parameters<typeof revisionQuery>[0],
  userId: string,
) {
  const timestamp = now();
  const due = await db
    .selectFrom("emergency_access")
    .select(["id", "grantor_id", "grantee_id"])
    .where("status", "=", Status.Initiated)
    .where((eb) =>
      eb.or([eb("grantor_id", "=", userId), eb("grantee_id", "=", userId)]),
    )
    .where(
      sql<boolean>`recovery_initiated_at + wait_time_days * 86400 <= ${timestamp}`,
    )
    .execute();
  for (const row of due) {
    const changed = await db
      .updateTable("emergency_access")
      .set({ status: Status.Approved, updated_at: timestamp })
      .where("id", "=", row.id)
      .where("status", "=", Status.Initiated)
      .executeTakeFirst();
    if (changed.numUpdatedRows === 1n) {
      await Promise.all(
        [
          revisionQuery(db, row.grantor_id, timestamp),
          revisionQuery(db, row.grantee_id, timestamp),
        ].map((query) => db.executeQuery(query)),
      );
    }
  }
}

function baseResponse(row: EmergencyRow) {
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    waitTimeDays: row.wait_time_days,
    recoveryInitiatedDate: row.recovery_initiated_at
      ? toIso(row.recovery_initiated_at)
      : null,
    object: "emergencyAccess",
  };
}

async function getAccess(db: Parameters<typeof revisionQuery>[0], id: string) {
  return db
    .selectFrom("emergency_access")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst() as Promise<EmergencyRow | undefined>;
}

export const listTrustedEmergencyContacts = factory.createHandlers(
  async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    await approveExpired(db, user.id);
    const rows = await db
      .selectFrom("emergency_access as access")
      .innerJoin("users as grantee", "grantee.id", "access.grantee_id")
      .select([
        "access.id",
        "access.status",
        "access.type",
        "access.wait_time_days",
        "access.recovery_initiated_at",
        "access.created_at",
        "access.updated_at",
        "access.grantor_id",
        "access.grantee_id",
        "access.key_encrypted",
        "grantee.email",
        "grantee.name",
      ])
      .where("access.grantor_id", "=", user.id)
      .orderBy("access.created_at", "asc")
      .execute();
    return c.json({
      data: rows.map((row) => ({
        ...baseResponse(row),
        granteeId: row.grantee_id,
        email: row.email,
        name: row.name,
        avatarColor: null,
        object: "emergencyAccessGranteeDetails",
      })),
      object: "list",
      continuationToken: null,
    });
  },
);

export const listGrantedEmergencyAccess = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  await approveExpired(db, user.id);
  const rows = await db
    .selectFrom("emergency_access as access")
    .innerJoin("users as grantor", "grantor.id", "access.grantor_id")
    .select([
      "access.id",
      "access.status",
      "access.type",
      "access.wait_time_days",
      "access.recovery_initiated_at",
      "access.created_at",
      "access.updated_at",
      "access.grantor_id",
      "access.grantee_id",
      "access.key_encrypted",
      "grantor.email",
      "grantor.name",
    ])
    .where("access.grantee_id", "=", user.id)
    .orderBy("access.created_at", "asc")
    .execute();
  return c.json({
    data: rows.map((row) => ({
      ...baseResponse(row),
      grantorId: row.grantor_id,
      email: row.email,
      name: row.name,
      avatarColor: null,
      object: "emergencyAccessGrantorDetails",
    })),
    object: "list",
    continuationToken: null,
  });
});

export const inviteEmergencyContact = factory.createHandlers(
  vValidator("json", EmergencyAccessInviteSchema),
  async (c) => {
    const body = c.req.valid("json");
    const grantor = c.get("user");
    if (body.email === grantor.email)
      return errorResponse(
        "You cannot set yourself as an emergency contact.",
        400,
      );
    const db = c.get("db");
    const grantee = await db
      .selectFrom("users")
      .select(["id", "email", "name"])
      .where("email", "=", body.email)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!grantee)
      return errorResponse(
        "Emergency contact must already have an account on this server.",
        404,
      );
    const timestamp = now();
    try {
      await c.get("dbDialect").batch([
        db.insertInto("emergency_access").values({
          id: crypto.randomUUID(),
          grantor_id: grantor.id,
          grantee_id: grantee.id,
          key_encrypted: null,
          type: emergencyAccessType(body.type),
          status: Status.Accepted,
          wait_time_days: body.waitTimeDays,
          recovery_initiated_at: null,
          created_at: timestamp,
          updated_at: timestamp,
        }),
        revisionQuery(db, grantor.id, timestamp),
        revisionQuery(db, grantee.id, timestamp),
      ]);
    } catch (error) {
      if (String(error).toLowerCase().includes("unique"))
        return errorResponse("This user is already an emergency contact.", 409);
      throw error;
    }
    await safeWriteAuditEvent(db, {
      actorUserId: grantor.id,
      action: "emergency_access.invite",
      category: "auth",
      targetType: "user",
      targetId: grantee.id,
      metadata: {
        targetEmail: grantee.email,
        type: emergencyAccessType(body.type),
      },
    });
    scheduleTransactionalEmail(c.executionCtx, db, c.env, (settings) =>
      emergencyAccessEmail({
        event: "invited",
        to: grantee.email,
        actorName: grantor.name,
        actorEmail: grantor.email,
        requestUrl: c.req.url,
        privacyMode: settings.privacyMode,
      }),
    );
    return new Response(null, { status: 200 });
  },
);

export const confirmEmergencyContact = factory.createHandlers(
  vValidator("json", EmergencyAccessConfirmSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const id = String(c.req.param("id") ?? "");
    const db = c.get("db");
    const timestamp = now();
    const [changed] = await c.get("dbDialect").batch([
      db
        .updateTable("emergency_access")
        .set({
          status: Status.Confirmed,
          key_encrypted: body.key,
          updated_at: timestamp,
        })
        .where("id", "=", id)
        .where("grantor_id", "=", user.id)
        .where("status", "=", Status.Accepted),
      revisionQuery(db, user.id, timestamp),
    ]);
    if (changed.numAffectedRows !== 1n)
      return errorResponse(
        "Emergency access is not awaiting confirmation.",
        409,
      );
    const row = await getAccess(db, id);
    if (!row) return errorResponse("Emergency access not found.", 404);
    await db.executeQuery(revisionQuery(db, row.grantee_id, timestamp));
    const grantee = await db
      .selectFrom("users")
      .select("email")
      .where("id", "=", row.grantee_id)
      .executeTakeFirst();
    if (grantee)
      scheduleTransactionalEmail(c.executionCtx, db, c.env, (settings) =>
        emergencyAccessEmail({
          event: "confirmed",
          to: grantee.email,
          actorName: user.name,
          actorEmail: user.email,
          requestUrl: c.req.url,
          privacyMode: settings.privacyMode,
        }),
      );
    return c.json(baseResponse(row));
  },
);

export const updateEmergencyContact = factory.createHandlers(
  vValidator("json", EmergencyAccessUpdateSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const db = c.get("db");
    const current = await getAccess(db, String(c.req.param("id") ?? ""));
    if (!current || current.grantor_id !== user.id)
      return errorResponse("Emergency access not found.", 404);
    if (current.status === Status.Accepted && !body.keyEncrypted)
      return errorResponse("Confirm this contact before changing it.", 409);
    const updated = await db
      .updateTable("emergency_access")
      .set({
        type: emergencyAccessType(body.type),
        wait_time_days: body.waitTimeDays,
        key_encrypted: body.keyEncrypted ?? current.key_encrypted,
        updated_at: now(),
      })
      .where("id", "=", current.id)
      .where("updated_at", "=", current.updated_at)
      .executeTakeFirst();
    if (updated.numUpdatedRows !== 1n)
      return errorResponse("Emergency access changed by another request.", 409);
    await Promise.all(
      [current.grantor_id, current.grantee_id].map((id) =>
        db.executeQuery(revisionQuery(db, id)),
      ),
    );
    const next = await getAccess(db, current.id);
    if (!next) return errorResponse("Emergency access not found.", 404);
    return c.json(baseResponse(next));
  },
);

export const initiateEmergencyAccess = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  const timestamp = now();
  const [changed] = await c.get("dbDialect").batch([
    db
      .updateTable("emergency_access")
      .set({
        status: Status.Initiated,
        recovery_initiated_at: timestamp,
        updated_at: timestamp,
      })
      .where("id", "=", String(c.req.param("id") ?? ""))
      .where("grantee_id", "=", user.id)
      .where("status", "=", Status.Confirmed),
    revisionQuery(db, user.id, timestamp),
  ]);
  if (changed.numAffectedRows !== 1n)
    return errorResponse(
      "Emergency access is not confirmed or was already requested.",
      409,
    );
  const row = await getAccess(db, String(c.req.param("id") ?? ""));
  if (!row) return errorResponse("Emergency access not found.", 404);
  await db.executeQuery(revisionQuery(db, row.grantor_id, timestamp));
  await safeWriteAuditEvent(db, {
    actorUserId: user.id,
    action: "emergency_access.request",
    category: "auth",
    targetType: "emergency_access",
    targetId: row.id,
  });
  const grantor = await db
    .selectFrom("users")
    .select(["email", "name"])
    .where("id", "=", row.grantor_id)
    .executeTakeFirst();
  if (grantor)
    scheduleTransactionalEmail(c.executionCtx, db, c.env, (settings) =>
      emergencyAccessEmail({
        event: "requested",
        to: grantor.email,
        actorName: user.name,
        actorEmail: user.email,
        requestUrl: c.req.url,
        privacyMode: settings.privacyMode,
      }),
    );
  return c.json(baseResponse(row));
});

async function decide(c: Context<HonoEnv>, approved: boolean) {
  const user = c.get("user");
  const db = c.get("db");
  const timestamp = now();
  const next = approved ? Status.Approved : Status.Confirmed;
  const changed = await db
    .updateTable("emergency_access")
    .set({
      status: next,
      recovery_initiated_at: approved ? sql`recovery_initiated_at` : null,
      updated_at: timestamp,
    })
    .where("id", "=", String(c.req.param("id") ?? ""))
    .where("grantor_id", "=", user.id)
    .where("status", "=", Status.Initiated)
    .executeTakeFirst();
  if (changed.numUpdatedRows !== 1n)
    return errorResponse("There is no pending emergency access request.", 409);
  const row = await getAccess(db, String(c.req.param("id") ?? ""));
  if (!row) return errorResponse("Emergency access not found.", 404);
  await Promise.all(
    [row.grantor_id, row.grantee_id].map((id) =>
      db.executeQuery(revisionQuery(db, id, timestamp)),
    ),
  );
  await safeWriteAuditEvent(db, {
    actorUserId: user.id,
    action: approved ? "emergency_access.approve" : "emergency_access.reject",
    category: "auth",
    targetType: "emergency_access",
    targetId: row.id,
  });
  const grantee = await db
    .selectFrom("users")
    .select(["email", "name"])
    .where("id", "=", row.grantee_id)
    .executeTakeFirst();
  if (grantee)
    scheduleTransactionalEmail(c.executionCtx, db, c.env, (settings) =>
      emergencyAccessEmail({
        event: approved ? "approved" : "rejected",
        to: grantee.email,
        actorName: user.name,
        actorEmail: user.email,
        requestUrl: c.req.url,
        privacyMode: settings.privacyMode,
      }),
    );
  return c.json(baseResponse(row));
}

export const approveEmergencyAccess = factory.createHandlers((c) =>
  decide(c, true),
);
export const rejectEmergencyAccess = factory.createHandlers((c) =>
  decide(c, false),
);

export const deleteEmergencyAccess = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  const row = await getAccess(db, String(c.req.param("id") ?? ""));
  if (!row || (row.grantor_id !== user.id && row.grantee_id !== user.id))
    return errorResponse("Emergency access not found.", 404);
  await db.deleteFrom("emergency_access").where("id", "=", row.id).execute();
  await Promise.all(
    [row.grantor_id, row.grantee_id].map((id) =>
      db.executeQuery(revisionQuery(db, id)),
    ),
  );
  await safeWriteAuditEvent(db, {
    actorUserId: user.id,
    action: "emergency_access.delete",
    category: "auth",
    targetType: "emergency_access",
    targetId: row.id,
  });
  return new Response(null, { status: 200 });
});

async function approvedAccess(c: Context<HonoEnv>, type: 0 | 1) {
  await approveExpired(c.get("db"), c.get("user").id);
  const row = await getAccess(c.get("db"), String(c.req.param("id") ?? ""));
  return row &&
    row.grantee_id === c.get("user").id &&
    row.status === Status.Approved &&
    row.type === type
    ? row
    : null;
}

export const viewEmergencyAccess = factory.createHandlers(async (c) => {
  const access = await approvedAccess(c, 0);
  if (!access)
    return errorResponse("Emergency access is not approved for viewing.", 403);
  const db = c.get("db");
  const ciphers = await db
    .selectFrom("ciphers")
    .selectAll()
    .where("user_id", "=", access.grantor_id)
    .where("org_id", "is", null)
    .execute();
  const attachments = ciphers.length
    ? await db
        .selectFrom("attachments")
        .selectAll()
        .where(
          "cipher_id",
          "in",
          ciphers.map((cipher) => cipher.id),
        )
        .execute()
    : [];
  const grouped = Map.groupBy(
    attachments,
    (attachment) => attachment.cipher_id,
  );
  return c.json({
    ciphers: ciphers.map((cipher) =>
      cipherToResponse(cipher, grouped.get(cipher.id), [], {
        edit: false,
        viewPassword: true,
      }),
    ),
    keyEncrypted: access.key_encrypted,
    object: "emergencyAccessView",
  });
});

export const takeoverEmergencyAccess = factory.createHandlers(async (c) => {
  const access = await approvedAccess(c, 1);
  if (!access)
    return errorResponse("Emergency access is not approved for takeover.", 403);
  const grantor = await c
    .get("db")
    .selectFrom("users")
    .select([
      "kdf_type",
      "kdf_iterations",
      "kdf_memory",
      "kdf_parallelism",
      "master_password_salt",
      "email",
    ])
    .where("id", "=", access.grantor_id)
    .executeTakeFirstOrThrow();
  return c.json({
    kdf: grantor.kdf_type,
    kdfIterations: grantor.kdf_iterations,
    kdfMemory: grantor.kdf_memory,
    kdfParallelism: grantor.kdf_parallelism,
    keyEncrypted: access.key_encrypted,
    salt: grantor.master_password_salt ?? grantor.email,
    object: "emergencyAccessTakeover",
  });
});

export const takeoverEmergencyAccessPassword = factory.createHandlers(
  vValidator("json", EmergencyAccessPasswordSchema),
  async (c) => {
    const access = await approvedAccess(c, 1);
    if (!access)
      return errorResponse(
        "Emergency access is not approved for takeover.",
        403,
      );
    const db = c.get("db");
    const grantor = await db
      .selectFrom("users")
      .select([
        "email",
        "security_stamp",
        "master_password_salt",
        "kdf_type",
        "kdf_iterations",
        "kdf_memory",
        "kdf_parallelism",
        "user_key_id",
      ])
      .where("id", "=", access.grantor_id)
      .executeTakeFirstOrThrow();
    const body = c.req.valid("json");
    let clientHash: string;
    let wrappedKey: string;
    if (body.authenticationData && body.unlockData) {
      const authentication = body.authenticationData;
      const unlock = body.unlockData;
      const salt = grantor.master_password_salt ?? grantor.email;
      const sameKdf =
        JSON.stringify(authentication.kdf) === JSON.stringify(unlock.kdf) &&
        authentication.kdf.kdfType === grantor.kdf_type &&
        authentication.kdf.iterations === grantor.kdf_iterations &&
        (authentication.kdf.memory ?? null) === grantor.kdf_memory &&
        (authentication.kdf.parallelism ?? null) === grantor.kdf_parallelism;
      if (
        authentication.salt !== salt ||
        unlock.salt !== salt ||
        !sameKdf ||
        (unlock.containedKeyId != null &&
          unlock.containedKeyId !== grantor.user_key_id)
      )
        return errorResponse(
          "Emergency takeover key parameters are invalid.",
          400,
        );
      clientHash = authentication.masterPasswordAuthenticationHash;
      wrappedKey = unlock.masterKeyWrappedUserKey;
    } else {
      clientHash = String(body.newMasterPasswordHash);
      wrappedKey = String(body.key);
    }
    const stamp = crypto.randomUUID();
    const timestamp = now();
    const hash = await hashPasswordServer(clientHash, grantor.email);
    const [changed] = await c.get("dbDialect").batch([
      db
        .updateTable("users")
        .set({
          master_password_hash: hash,
          key: wrappedKey,
          security_stamp: stamp,
          totp_secret: null,
          totp_recovery_code: null,
          yubikey_config: '{"keys":[],"nfc":false}',
          updated_at: timestamp,
        })
        .where("id", "=", access.grantor_id)
        .where("security_stamp", "=", grantor.security_stamp),
      db
        .deleteFrom("refresh_tokens")
        .where("user_id", "=", access.grantor_id)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("users")
              .select("id")
              .where("id", "=", access.grantor_id)
              .where("security_stamp", "=", stamp),
          ),
        ),
      db
        .deleteFrom("webauthn_credentials")
        .where("user_id", "=", access.grantor_id)
        .where("purpose", "=", "twoFactor")
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("users")
              .select("id")
              .where("id", "=", access.grantor_id)
              .where("security_stamp", "=", stamp),
          ),
        ),
      db
        .deleteFrom("org_members")
        .where("user_id", "=", access.grantor_id)
        .where("role", "!=", "owner")
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("users")
              .select("id")
              .where("id", "=", access.grantor_id)
              .where("security_stamp", "=", stamp),
          ),
        ),
      revisionQuery(db, access.grantor_id, timestamp),
    ]);
    if (changed.numAffectedRows !== 1n)
      return errorResponse(
        "The account changed during takeover. Retry with fresh data.",
        409,
      );
    invalidateUserCache(access.grantor_id);
    await safeWriteAuditEvent(db, {
      actorUserId: c.get("user").id,
      action: "emergency_access.takeover",
      category: "auth",
      level: "warning",
      targetType: "user",
      targetId: access.grantor_id,
    });
    scheduleTransactionalEmail(c.executionCtx, db, c.env, (settings) =>
      emergencyAccessEmail({
        event: "takeover",
        to: grantor.email,
        actorName: c.get("user").name,
        actorEmail: c.get("user").email,
        requestUrl: c.req.url,
        privacyMode: settings.privacyMode,
      }),
    );
    return new Response(null, { status: 200 });
  },
);

export const emergencyAccessPolicies = factory.createHandlers(async (c) => {
  const access = await approvedAccess(c, 1);
  if (!access)
    return errorResponse("Emergency access is not approved for takeover.", 403);
  return c.json({ data: [], object: "list", continuationToken: null });
});
