import type { Context } from "hono";
import { type Selectable, sql } from "kysely";
import type { HonoEnv } from "../env";
import { factory } from "../http/factory";
import { cipherToResponse } from "../services/ciphers/presentation";
import * as attachmentsDb from "../services/db/attachments";
import * as ciphersDb from "../services/db/ciphers";
import * as domainSettingsDb from "../services/db/domain-settings";
import * as foldersDb from "../services/db/folders";
import { textColumnInJson } from "../services/db/json-array";
import {
  getRevisionValue,
  readAtStableRevision,
} from "../services/db/revisions";
import * as sendsDb from "../services/db/sends";
import * as usersDb from "../services/db/users";
import * as webauthnDb from "../services/db/webauthn";
import {
  buildDomainsResponse,
  parseStoredDomainSettings,
} from "../services/domain-rules";
import {
  organizationRoleType,
  profileOrganizationToResponse,
} from "../services/organizations/profile-presentation";
import { sendToResponse } from "../services/sends/presentation";
import type { Folders } from "../types/db";
import { buildWebAuthnPrfOption } from "../utils/account-passkeys";
import { now, toIso } from "../utils/time";
import {
  buildAccountKeys,
  buildUserDecryptionCompat,
  buildUserDecryptionOptions,
} from "../utils/user-decryption";
import { userYubicoPublicIds } from "../utils/yubico";

export function supportsSshKeys(clientVersion: string | undefined): boolean {
  if (!clientVersion) return true;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(clientVersion.trim());
  if (!match) return true;
  const [year, month] = [Number(match[1]), Number(match[2])];
  return year > 2024 || (year === 2024 && month >= 12);
}

export { organizationRoleType };

type SyncStage =
  | "revision.before"
  | "coreBatch"
  | "vaultBatch"
  | "presentation"
  | "revision.after"
  | "response";

type SyncTelemetry = {
  currentStage: SyncStage | null;
  attempts: number;
  revisionReads: number;
  durationsMs: Partial<Record<SyncStage, number>>;
  counts: Record<string, number>;
};

async function measureSyncStage<T>(
  telemetry: SyncTelemetry,
  stage: SyncStage,
  operation: () => Promise<T> | T,
): Promise<T> {
  telemetry.currentStage = stage;
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    telemetry.durationsMs[stage] = Number(
      (
        (telemetry.durationsMs[stage] ?? 0) +
        performance.now() -
        startedAt
      ).toFixed(1),
    );
  }
}

function folderToResponse(folder: Selectable<Folders>) {
  return {
    id: folder.id,
    name: folder.name,
    creationDate: toIso(folder.created_at),
    revisionDate: toIso(folder.updated_at),
    object: "folder",
  };
}

async function buildSyncPayload(
  c: Context<HonoEnv>,
  excludeDomains: boolean,
  telemetry: SyncTelemetry,
) {
  telemetry.attempts += 1;
  const db = c.get("db");
  const userId = c.get("user").id;
  const syncTimestamp = now();
  const organizationRowsQuery = db
    .selectFrom("org_members as member")
    .innerJoin("organizations as org", "org.id", "member.org_id")
    .select([
      "member.id as member_id",
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
    .where("org.deletion_requested_at", "is", null);
  const restrictedCollectionAccessQuery = db
    .selectFrom("collection_members as access")
    .innerJoin("org_members as member", "member.id", "access.org_member_id")
    .innerJoin("organizations as org", "org.id", "member.org_id")
    .select([
      "access.collection_id",
      "access.read_only",
      "access.hide_passwords",
      "access.manage",
    ])
    .where("member.user_id", "=", userId)
    .where("member.status", "=", "confirmed")
    .where("member.access_all", "=", 0)
    .where("org.deletion_requested_at", "is", null);
  // D1 executes a batch sequentially in one transaction and one binding call.
  // These reads only depend on userId, so batching removes six remote
  // round trips while preserving a consistent view of the core account data.
  const coreBatchStartedAt = performance.now();
  telemetry.currentStage = "coreBatch";
  const core = excludeDomains
    ? await (async () => {
        const [
          user,
          personalCiphers,
          folders,
          accountCredentials,
          sends,
          organizations,
          restrictedCollectionAccess,
        ] = await c
          .get("dbDialect")
          .batch([
            usersDb.getUserByIdQuery(db, userId),
            ciphersDb.getAllCiphersByUserIdQuery(db, userId),
            foldersDb.getFoldersByUserIdQuery(db, userId),
            webauthnDb.listAllAccountPasskeyCredentialsByUserIdQuery(
              db,
              userId,
            ),
            sendsDb.getSendsByUserIdQuery(db, userId, syncTimestamp),
            organizationRowsQuery,
            restrictedCollectionAccessQuery,
          ]);
        return {
          user,
          personalCiphers,
          folders,
          domainSettings: null,
          accountCredentials,
          sends,
          organizations,
          restrictedCollectionAccess,
        };
      })()
    : await (async () => {
        const [
          user,
          personalCiphers,
          folders,
          domainSettings,
          accountCredentials,
          sends,
          organizations,
          restrictedCollectionAccess,
        ] = await c
          .get("dbDialect")
          .batch([
            usersDb.getUserByIdQuery(db, userId),
            ciphersDb.getAllCiphersByUserIdQuery(db, userId),
            foldersDb.getFoldersByUserIdQuery(db, userId),
            domainSettingsDb.getDomainSettingsQuery(db, userId),
            webauthnDb.listAllAccountPasskeyCredentialsByUserIdQuery(
              db,
              userId,
            ),
            sendsDb.getSendsByUserIdQuery(db, userId, syncTimestamp),
            organizationRowsQuery,
            restrictedCollectionAccessQuery,
          ]);
        return {
          user,
          personalCiphers,
          folders,
          domainSettings,
          accountCredentials,
          sends,
          organizations,
          restrictedCollectionAccess,
        };
      })();
  telemetry.durationsMs.coreBatch = Number(
    (performance.now() - coreBatchStartedAt).toFixed(1),
  );
  const user = core.user.rows[0] ?? c.get("user");
  const personalCiphers = ciphersDb.mapCipherViewRows(
    core.personalCiphers.rows as ciphersDb.CipherViewRow[],
  );
  const folders = core.folders.rows;
  const domainSettings = core.domainSettings?.rows[0] ?? null;
  const accountCredentials = core.accountCredentials.rows;
  const accountPasskeys = accountCredentials.filter(
    (credential) => credential.purpose === "login",
  );
  const hasTwoFactorPasskey = accountCredentials.some(
    (credential) => credential.purpose === "twoFactor",
  );
  const sends = core.sends.rows;
  const organizationRows = core.organizations.rows;
  const organizationIds = organizationRows.map((row) => row.org_id);
  const allAccessOrgIds = organizationRows
    .filter((row) => row.access_all === 1)
    .map((row) => row.org_id);
  const restrictedCollectionAccess = core.restrictedCollectionAccess.rows;
  const allowedRestrictedCollectionIds = restrictedCollectionAccess.map(
    (row) => row.collection_id,
  );
  const restrictedAccessByCollection = new Map(
    restrictedCollectionAccess.map((row) => [row.collection_id, row]),
  );
  const visibleCollectionsQuery = db
    .selectFrom("collections")
    .selectAll()
    .where((expression) =>
      expression.or([
        sql<boolean>`org_id in (
					select value from json_each(${JSON.stringify(allAccessOrgIds)})
				)`,
        textColumnInJson("id", allowedRestrictedCollectionIds),
      ]),
    );
  const organizationCiphersQuery = db
    .selectFrom("ciphers")
    .leftJoin("cipher_user_settings as view", (join) =>
      join
        .onRef("view.cipher_id", "=", "ciphers.id")
        .on("view.user_id", "=", user.id),
    )
    .selectAll("ciphers")
    .select([
      "view.folder_id as folder_id",
      "view.favorite as favorite",
      "view.archived_at as archived_at",
    ])
    .where((expression) =>
      expression.or([
        sql<boolean>`org_id in (
					select value from json_each(${JSON.stringify(allAccessOrgIds)})
				)`,
        sql<boolean>`id in (
					select cipher_id
					from cipher_collections
					where collection_id in (
						select value from json_each(${JSON.stringify(allowedRestrictedCollectionIds)})
					)
				)`,
      ]),
    )
    .where((expression) =>
      expression.or([
        expression("purge_after", "is", null),
        expression("purge_after", ">", syncTimestamp),
      ]),
    );

  const webAuthnPrfOptions = accountPasskeys
    .map(buildWebAuthnPrfOption)
    .filter((option): option is NonNullable<typeof option> => !!option);
  const firstPrfOption = webAuthnPrfOptions[0] || null;
  const userDecryptionOptions = buildUserDecryptionOptions(
    user,
    firstPrfOption,
  );

  const attachmentsQuery = attachmentsDb.listVisibleForSyncQuery(
    db,
    user.id,
    allAccessOrgIds,
    allowedRestrictedCollectionIds,
  );
  const cipherCollectionLinksQuery = db
    .selectFrom("cipher_collections")
    .selectAll()
    .where((expression) =>
      expression.or([
        sql<boolean>`cipher_id in (
					select id from ciphers where user_id = ${user.id}
					union
					select id from ciphers where org_id in (
						select value from json_each(${JSON.stringify(allAccessOrgIds)})
					)
				)`,
        textColumnInJson("collection_id", allowedRestrictedCollectionIds),
      ]),
    );
  telemetry.currentStage = "vaultBatch";
  const vaultBatchStartedAt = performance.now();
  const [
    visibleCollectionResult,
    organizationCipherResult,
    attachmentResult,
    cipherCollectionLinkResult,
  ] = await c
    .get("dbDialect")
    .batch([
      visibleCollectionsQuery,
      organizationCiphersQuery,
      attachmentsQuery,
      cipherCollectionLinksQuery,
    ]);
  telemetry.durationsMs.vaultBatch = Number(
    (performance.now() - vaultBatchStartedAt).toFixed(1),
  );
  const visibleCollections = organizationIds.length
    ? visibleCollectionResult.rows
    : [];
  const organizationCiphers = organizationIds.length
    ? organizationCipherResult.rows
    : [];
  // Vaultwarden withholds SSH-key ciphers from clients older than 2024.12.0;
  // those clients do not know cipher type 5 and can reject the entire sync.
  const includeSshKeys = supportsSshKeys(
    c.req.header("Bitwarden-Client-Version"),
  );
  const allCiphers = [...personalCiphers, ...organizationCiphers].filter(
    (cipher) => includeSshKeys || cipher.type !== 5,
  );
  const attachments = attachmentResult.rows;
  const attachmentsByCipher = Map.groupBy(
    attachments,
    (attachment) => attachment.cipher_id,
  );
  const cipherCollectionLinks = cipherCollectionLinkResult.rows;
  const collectionIdsByCipher = Map.groupBy(
    cipherCollectionLinks,
    (link) => link.cipher_id,
  );

  const profileOrganizations = organizationRows.map((row) =>
    profileOrganizationToResponse(row, user.id),
  );
  const profile = {
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
      hasTwoFactorPasskey ||
      userYubicoPublicIds(user as any).length > 0,
    key: user.key,
    privateKey: user.private_key,
    publicKey: user.public_key,
    accountKeys: buildAccountKeys(user),
    securityStamp: user.security_stamp,
    forcePasswordReset: false,
    usesKeyConnector: false,
    avatarColor: null,
    creationDate: toIso(user.created_at),
    verifyDevices: user.verify_devices === 1,
    kdf: user.kdf_type,
    kdfIterations: user.kdf_iterations,
    kdfMemory: user.kdf_memory ?? null,
    kdfParallelism: user.kdf_parallelism ?? null,
    role: user.role,
    organizations: profileOrganizations,
    organizationsNew: profileOrganizations,
    providers: [],
    providerOrganizations: [],
    object: "profile",
  };

  const storedDomains = domainSettings
    ? parseStoredDomainSettings(domainSettings)
    : {
        equivalentDomains: [],
        customEquivalentDomains: [],
        excludedGlobalEquivalentDomains: [],
      };
  const {
    equivalentDomains,
    customEquivalentDomains,
    excludedGlobalEquivalentDomains,
  } = storedDomains;

  const domains = excludeDomains
    ? null
    : buildDomainsResponse(
        equivalentDomains,
        customEquivalentDomains,
        excludedGlobalEquivalentDomains,
      );

  telemetry.currentStage = "presentation";
  const presentationStartedAt = performance.now();
  const payload = {
    profile,
    folders: folders.map(folderToResponse),
    collections: visibleCollections.map((collection) => {
      const access = restrictedAccessByCollection.get(collection.id);
      return {
        id: collection.id,
        organizationId: collection.org_id,
        name: collection.name,
        externalId: null,
        type: 0,
        defaultUserCollectionEmail: null,
        readOnly: Boolean(access?.read_only),
        hidePasswords: Boolean(access?.hide_passwords),
        manage: Boolean(access?.manage),
        creationDate: toIso(collection.created_at),
        revisionDate: toIso(collection.updated_at),
        object: "collectionDetails",
      };
    }),
    ciphers: allCiphers.map((cipher) => {
      const collectionIds =
        collectionIdsByCipher
          .get(cipher.id)
          ?.map((link) => link.collection_id) ?? [];
      const hasUnrestrictedAccess =
        !cipher.org_id || allAccessOrgIds.includes(cipher.org_id);
      const restrictedAccess = !hasUnrestrictedAccess
        ? collectionIds.map((id) => restrictedAccessByCollection.get(id))
        : [];
      return cipherToResponse(
        cipher,
        attachmentsByCipher.get(cipher.id),
        collectionIds,
        {
          edit:
            hasUnrestrictedAccess ||
            restrictedAccess.some((access) => access?.read_only !== 1),
          viewPassword:
            hasUnrestrictedAccess ||
            restrictedAccess.some((access) => access?.hide_passwords !== 1),
        },
        "cipher",
      );
    }),
    domains,
    policies: [],
    policiesNew: [],

    sends: sends.map(sendToResponse),
    unofficialServer: true,
    // Emit each SDK field once. PascalCase duplicates are accepted as aliases
    // individually, but strict native SDK models reject both names together.
    userDecryptionOptions,
    userDecryption: buildUserDecryptionCompat(user, webAuthnPrfOptions),
    object: "sync",
  };
  telemetry.durationsMs.presentation = Number(
    (performance.now() - presentationStartedAt).toFixed(1),
  );
  telemetry.counts = {
    ciphers: allCiphers.length,
    personalCiphers: personalCiphers.length,
    organizationCiphers: organizationCiphers.length,
    folders: folders.length,
    organizations: organizationRows.length,
    collections: visibleCollections.length,
    attachments: attachments.length,
    sends: sends.length,
    accountCredentials: accountCredentials.length,
  };
  return payload;
}

// GET /api/sync
export const sync = factory.createHandlers(async (c) => {
  const startedAt = performance.now();
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  const telemetry: SyncTelemetry = {
    currentStage: null,
    attempts: 0,
    revisionReads: 0,
    durationsMs: {},
    counts: {},
  };
  const db = c.get("db");
  const userId = c.get("user").id;
  const excludeDomains = c.req.query("excludeDomains") === "true";
  try {
    const payload = await readAtStableRevision({
      readRevision: () => {
        const stage =
          telemetry.revisionReads % 2 === 0
            ? "revision.before"
            : "revision.after";
        telemetry.revisionReads += 1;
        return measureSyncStage(telemetry, stage, () =>
          getRevisionValue(db, userId),
        );
      },
      read: () => buildSyncPayload(c, excludeDomains, telemetry),
    });
    if (!payload) {
      console.warn(
        JSON.stringify({
          event: "sync.unstable_revision",
          requestId,
          attempts: telemetry.attempts,
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
          stagesMs: telemetry.durationsMs,
          counts: telemetry.counts,
        }),
      );
      return c.json(
        {
          message: "Vault changed repeatedly while synchronizing; retry",
          object: "error",
        },
        503,
        { "Retry-After": "1" },
      );
    }
    const responseStartedAt = performance.now();
    telemetry.currentStage = "response";
    const response = c.json(payload);
    telemetry.durationsMs.response = Number(
      (performance.now() - responseStartedAt).toFixed(1),
    );
    console.log(
      JSON.stringify({
        event: "sync.completed",
        requestId,
        excludeDomains,
        attempts: telemetry.attempts,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        stagesMs: telemetry.durationsMs,
        counts: telemetry.counts,
      }),
    );
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "sync.failed",
        requestId,
        stage: telemetry.currentStage,
        attempts: telemetry.attempts,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        stagesMs: telemetry.durationsMs,
        counts: telemetry.counts,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    throw error;
  }
});
