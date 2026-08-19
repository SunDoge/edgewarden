import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
  ChangePasswordSchema,
  SetVerifyDevicesSchema,
  SetKeysSchema,
  UpdateProfileSchema,
  VerifyPasswordSchema,
} from "../schemas/accounts";
import { rotateUserApiKey } from "../services/account-api-key";
import {
  hashPasswordServer,
  invalidateUserCache,
  verifyPassword,
} from "../services/auth";
import {
  decryptCredential,
  encryptCredential,
  hashCredential,
} from "../services/credential-protection";
import {
  conditionalRefreshTokenDeletionQuery,
  conditionalUserUpdatedAtRevisionQuery,
  conditionalUserRevisionQuery,
} from "../services/db/batch";
import * as revisionsDb from "../services/db/revisions";
import * as usersDb from "../services/db/users";
import * as webauthnDb from "../services/db/webauthn";
import { buildAccountKeys } from "../utils/user-decryption";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";
import { userYubicoPublicIds } from "../utils/yubico";

function buildProfileResponse(
  user: NonNullable<Awaited<ReturnType<typeof usersDb.getUserById>>>,
  twoFactorPasskeys = 0,
  organizations: Array<Record<string, unknown>> = [],
) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    premium: true,
    premiumFromOrganization: false,
    masterPasswordHint: user.master_password_hint,
    culture: "en-US",
    twoFactorEnabled:
      !!user.totp_secret ||
      twoFactorPasskeys > 0 ||
      userYubicoPublicIds(user as any).length > 0,
    key: user.key,
    privateKey: user.private_key,
    publicKey: user.public_key,
    accountKeys: buildAccountKeys(user),
    securityStamp: user.security_stamp,
    forcePasswordReset: false,
    usesKeyConnector: false,
    avatarColor: null,
    kdf: user.kdf_type,
    kdfIterations: user.kdf_iterations,
    kdfMemory: user.kdf_memory ?? null,
    kdfParallelism: user.kdf_parallelism ?? null,
    creationDate: toIso(user.created_at),
    verifyDevices: user.verify_devices === 1,
    organizations,
    organizationsNew: organizations,
    providers: [],
    providerOrganizations: [],
    object: "profile",
  };
}

async function getProfileOrganizations(
  db: Parameters<typeof usersDb.getUserById>[0],
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .selectFrom("org_members as member")
    .innerJoin("organizations as org", "org.id", "member.org_id")
    .select([
      "member.org_id",
      "member.key",
      "member.role",
      "member.status",
      "member.access_all",
      "org.name",
      "org.public_key",
      "org.private_key",
      "org.created_at",
      "org.updated_at",
    ])
    .where("member.user_id", "=", userId)
    .where("member.status", "=", "confirmed")
    .where("org.deletion_requested_at", "is", null)
    .execute();
  return rows.map((row) => ({
    id: row.org_id,
    name: row.name,
    key: row.key,
    publicKey: row.public_key,
    privateKey: row.private_key,
    role: row.role,
    status: row.status,
    accessAll: Boolean(row.access_all),
    creationDate: toIso(row.created_at),
    revisionDate: toIso(row.updated_at),
    object: "profileOrganization",
  }));
}

// GET /api/accounts/profile
export const getProfile = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const count = await webauthnDb.countAccountPasskeyCredentialsByUserId(
    c.get("db"),
    user.id,
    "twoFactor",
  );
  return c.json(
    buildProfileResponse(
      user,
      count,
      await getProfileOrganizations(c.get("db"), user.id),
    ),
  );
});

// PUT /api/accounts/profile
export const updateProfile = factory.createHandlers(
  vValidator("json", UpdateProfileSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const db = c.get("db");
    const updatedAt = Math.max(now(), user.updated_at + 1);

    let query = db
      .updateTable("users")
      .set({
        name: body.name ?? user.name,
        master_password_hint:
          body.masterPasswordHint ?? user.master_password_hint,
        updated_at: updatedAt,
      })
      .where("id", "=", user.id)
      .where("name", "=", user.name)
      .where("updated_at", "=", user.updated_at);
    query = user.master_password_hint
      ? query.where("master_password_hint", "=", user.master_password_hint)
      : query.where("master_password_hint", "is", null);
    const [changed] = await c
      .get("dbDialect")
      .batch([
        query,
        conditionalUserUpdatedAtRevisionQuery(
          db,
          user.id,
          updatedAt,
          updatedAt,
        ),
      ]);
    if (changed.numAffectedRows !== 1n)
      return errorResponse("Profile was changed by another request.", 409);
    invalidateUserCache(user.id);

    const updated = await usersDb.getUserById(db, user.id);
    if (!updated) return errorResponse("Profile not found", 404);
    const count = await webauthnDb.countAccountPasskeyCredentialsByUserId(
      db,
      user.id,
      "twoFactor",
    );
    return c.json(
      buildProfileResponse(
        updated,
        count,
        await getProfileOrganizations(db, updated.id),
      ),
    );
  },
);

// POST /api/accounts/keys
export const setKeys = factory.createHandlers(
  vValidator("json", SetKeysSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const db = c.get("db");

    let query = db
      .updateTable("users")
      .set({
        public_key: body.publicKey,
        private_key: body.encryptedPrivateKey,
        updated_at: now(),
      })
      .where("id", "=", user.id);
    query = user.public_key
      ? query.where("public_key", "=", user.public_key)
      : query.where("public_key", "is", null);
    query = user.private_key
      ? query.where("private_key", "=", user.private_key)
      : query.where("private_key", "is", null);
    const changed = await query.executeTakeFirst();
    if (changed.numUpdatedRows !== 1n)
      return errorResponse(
        "Account keys were changed by another request.",
        409,
      );
    invalidateUserCache(user.id);
    return new Response(null, { status: 200 });
  },
);

// POST /api/accounts/password (change password)
export const changePassword = factory.createHandlers(
  vValidator("json", ChangePasswordSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const db = c.get("db");

    const valid = await verifyPassword(
      body.masterPasswordHash,
      user.master_password_hash,
      user.email,
    );
    if (!valid) return errorResponse("Current password is incorrect.", 400);

    const newHash = await hashPasswordServer(
      body.newMasterPasswordHash,
      user.email,
    );
    const newStamp = crypto.randomUUID();

    const ts = now();
    const [updated] = await c.get("dbDialect").batch([
      db
        .updateTable("users")
        .set({
          master_password_hash: newHash,
          master_password_hint:
            body.masterPasswordHint ?? user.master_password_hint,
          key: body.key,
          security_stamp: newStamp,
          updated_at: ts,
        })
        .where("id", "=", user.id)
        .where("master_password_hash", "=", user.master_password_hash),
      conditionalRefreshTokenDeletionQuery(db, user.id, newStamp),
      conditionalUserRevisionQuery(db, user.id, newStamp, ts),
    ]);
    if (updated.numAffectedRows !== 1n)
      return errorResponse("Password was changed by another request.", 409);

    invalidateUserCache(user.id);
    return new Response(null, { status: 200 });
  },
);

// POST /api/accounts/verify-password
export const verifyAccountPassword = factory.createHandlers(
  vValidator("json", VerifyPasswordSchema),
  async (c) => {
    const { masterPasswordHash } = c.req.valid("json");
    const user = c.get("user");

    const valid = await verifyPassword(
      masterPasswordHash,
      user.master_password_hash,
      user.email,
    );
    if (!valid) return errorResponse("Invalid password.", 400);
    return new Response(null, { status: 200 });
  },
);

export const setVerifyDevices = factory.createHandlers(
  vValidator("json", SetVerifyDevicesSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    if (
      !(await verifyPassword(
        body.masterPasswordHash,
        user.master_password_hash,
        user.email,
      ))
    )
      return errorResponse("User verification failed.", 400);

    const updatedAt = Math.max(now(), user.updated_at + 1);
    const changed = await c
      .get("db")
      .updateTable("users")
      .set({
        verify_devices: body.verifyDevices ? 1 : 0,
        updated_at: updatedAt,
      })
      .where("id", "=", user.id)
      .where("updated_at", "=", user.updated_at)
      .executeTakeFirst();
    if (changed.numUpdatedRows !== 1n)
      return errorResponse("Account was changed by another request.", 409);
    invalidateUserCache(user.id);
    return new Response(null, { status: 200 });
  },
);

// GET /api/accounts/revision-date
export const getRevisionDate = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  const revisionDate = await revisionsDb.getRevisionDate(db, user.id);
  return c.json(revisionDate);
});

// POST /api/accounts/password-hint
export const requestPasswordHint = factory.createHandlers(async () => {
  // Never reveal hint over API — Bitwarden sends it via email
  // For self-hosted: just return 200 (or implement email later)
  return new Response(null, { status: 200 });
});

// GET /api/accounts/api-key
// POST /api/accounts/rotate-api-key
export const getApiKey = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  let key: string;
  if (user.api_key_encrypted) {
    try {
      key = await decryptCredential(
        user.api_key_encrypted,
        c.env.DATA_ENCRYPTION_SECRET,
        "api-key",
      );
    } catch {
      return errorResponse("Stored API key cannot be decrypted", 500);
    }
  } else {
    const candidate = crypto.randomUUID().replace(/-/g, "");
    const [hash, encrypted] = await Promise.all([
      hashCredential(candidate),
      encryptCredential(candidate, c.env.DATA_ENCRYPTION_SECRET, "api-key"),
    ]);
    const created = await db
      .updateTable("users")
      .set({
        api_key_hash: hash,
        api_key_encrypted: encrypted,
        updated_at: now(),
      })
      .where("id", "=", user.id)
      .where("api_key_encrypted", "is", null)
      .executeTakeFirst();
    if (created.numUpdatedRows === 1n) {
      key = candidate;
      invalidateUserCache(user.id);
    } else {
      const winner = await db
        .selectFrom("users")
        .select("api_key_encrypted")
        .where("id", "=", user.id)
        .executeTakeFirst();
      if (!winner?.api_key_encrypted)
        return errorResponse("API key creation conflicted", 409);
      try {
        key = await decryptCredential(
          winner.api_key_encrypted,
          c.env.DATA_ENCRYPTION_SECRET,
          "api-key",
        );
      } catch {
        return errorResponse("Stored API key cannot be decrypted", 500);
      }
    }
  }
  return c.json({ apiKey: key, object: "apiKey" });
});

export const rotateApiKey = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const key = await rotateUserApiKey(
    c.get("db"),
    user.id,
    user.api_key_encrypted,
    c.env.DATA_ENCRYPTION_SECRET,
  );
  if (!key)
    return errorResponse("API key was rotated by another request.", 409);
  invalidateUserCache(user.id);
  return c.json({ apiKey: key, object: "apiKey" });
});
