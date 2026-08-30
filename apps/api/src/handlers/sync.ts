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

export function organizationRoleType(role: string): number {
  return role === "owner"
    ? 0
    : role === "admin"
      ? 1
      : role === "manager"
        ? 4
        : 2;
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

async function buildSyncPayload(c: Context<HonoEnv>, excludeDomains: boolean) {
  const db = c.get("db");
  const userId = c.get("user").id;
  const user = (await usersDb.getUserById(db, userId)) ?? c.get("user");

  // Keep queries on the Kysely-D1 connection ordered. Promise.all does not make
  // a single D1 session faster and can make adapters overlap session requests.
  const personalCiphers = await ciphersDb.getAllCiphersByUserId(db, user.id);
  const folders = await foldersDb.getFoldersByUserId(db, user.id);
  const domainSettings = excludeDomains
    ? null
    : await domainSettingsDb.getDomainSettings(db, user.id);
  const accountCredentials =
    await webauthnDb.listAllAccountPasskeyCredentialsByUserId(db, user.id);
  const accountPasskeys = accountCredentials.filter(
    (credential) => credential.purpose === "login",
  );
  const hasTwoFactorPasskey = accountCredentials.some(
    (credential) => credential.purpose === "twoFactor",
  );
  const sends = await sendsDb.getSendsByUserId(db, user.id);
  const organizationRows = await db
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
    .where("member.user_id", "=", user.id)
    .where("member.status", "=", "confirmed")
    .where("org.deletion_requested_at", "is", null)
    .execute();
  const organizationIds = organizationRows.map((row) => row.org_id);
  const allAccessOrgIds = organizationRows
    .filter((row) => row.access_all === 1)
    .map((row) => row.org_id);
  const restrictedMembers = organizationRows.filter(
    (row) => row.access_all !== 1,
  );
  const restrictedCollectionAccess = restrictedMembers.length
    ? await db
        .selectFrom("collection_members")
        .select(["collection_id", "read_only", "hide_passwords", "manage"])
        .where(
          sql<boolean>`org_member_id in (select value from json_each(${JSON.stringify(restrictedMembers.map((row) => row.member_id))}))`,
        )
        .execute()
    : [];
  const allowedRestrictedCollectionIds = restrictedCollectionAccess.map(
    (row) => row.collection_id,
  );
  const restrictedAccessByCollection = new Map(
    restrictedCollectionAccess.map((row) => [row.collection_id, row]),
  );
  const visibleCollections = organizationIds.length
    ? await db
        .selectFrom("collections")
        .selectAll()
        .where((expression) =>
          expression.or([
            sql<boolean>`org_id in (
							select value from json_each(${JSON.stringify(allAccessOrgIds)})
						)`,
            textColumnInJson("id", allowedRestrictedCollectionIds),
          ]),
        )
        .execute()
    : [];
  const organizationCiphers = organizationIds.length
    ? await db
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
            expression("purge_after", ">", now()),
          ]),
        )
        .execute()
    : [];

  const webAuthnPrfOptions = accountPasskeys
    .map(buildWebAuthnPrfOption)
    .filter((option): option is NonNullable<typeof option> => !!option);
  const firstPrfOption = webAuthnPrfOptions[0] || null;
  const userDecryptionOptions = buildUserDecryptionOptions(
    user,
    firstPrfOption,
  );

  // Vaultwarden withholds SSH-key ciphers from clients older than 2024.12.0;
  // those clients do not know cipher type 5 and can reject the entire sync.
  const includeSshKeys = supportsSshKeys(
    c.req.header("Bitwarden-Client-Version"),
  );
  const allCiphers = [...personalCiphers, ...organizationCiphers].filter(
    (cipher) => includeSshKeys || cipher.type !== 5,
  );
  const attachments = await attachmentsDb.listVisibleForSync(
    db,
    user.id,
    allAccessOrgIds,
    allowedRestrictedCollectionIds,
  );
  const attachmentsByCipher = Map.groupBy(
    attachments,
    (attachment) => attachment.cipher_id,
  );
  const cipherCollectionLinks = await db
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
    )
    .execute();
  const collectionIdsByCipher = Map.groupBy(
    cipherCollectionLinks,
    (link) => link.cipher_id,
  );

  const profileOrganizations = organizationRows.map((row) => {
    const type = organizationRoleType(row.role);
    const customManager = type === 4;
    return {
      id: row.org_id,
      userId: user.id,
      organizationUserId: row.member_id,
      identifier: null,
      name: row.name,
      key: row.key,
      publicKey: row.public_key,
      privateKey: row.private_key,
      role: row.role,
      status: 2,
      type,
      enabled: true,
      accessAll: Boolean(row.access_all),
      usersGetPremium: true,
      usePolicies: true,
      useSso: false,
      useKeyConnector: false,
      useScim: false,
      useGroups: false,
      useDirectory: false,
      useEvents: false,
      useTotp: true,
      use2fa: true,
      useApi: true,
      useResetPassword: false,
      useSecretsManager: false,
      usePasswordManager: true,
      useCustomPermissions: true,
      useActivateAutofillPolicy: false,
      useRiskInsights: false,
      useOrganizationDomains: false,
      useAdminSponsoredFamilies: false,
      useAutomaticUserConfirmation: false,
      useDisableSMAdsForUsers: true,
      usePhishingBlocker: false,
      useMyItems: false,
      useInviteLinks: false,
      usePam: false,
      selfHost: true,
      seats: 20,
      maxCollections: null,
      maxStorageGb: 32767,
      hasPublicAndPrivateKeys: Boolean(row.public_key && row.private_key),
      ssoBound: false,
      resetPasswordEnrolled: false,
      limitCollectionCreation: customManager && !row.access_all,
      limitCollectionDeletion: true,
      limitItemDeletion: false,
      allowAdminAccessToAllCollectionItems: true,
      userIsClaimedByOrganization: false,
      userIsManagedByOrganization: false,
      permissions: customManager
        ? {
            accessEventLogs: false,
            accessImportExport: false,
            accessReports: false,
            createNewCollections: Boolean(row.access_all),
            editAnyCollection: Boolean(row.access_all),
            deleteAnyCollection: Boolean(row.access_all),
            manageGroups: false,
            managePolicies: false,
            manageSso: false,
            manageUsers: false,
            manageResetPassword: false,
            manageScim: false,
          }
        : null,
      creationDate: toIso(row.created_at),
      revisionDate: toIso(row.updated_at),
      object: "profileOrganization",
    };
  });
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

  return {
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
    // Legacy aliases are retained for older self-hosted clients. The official
    // SyncResponseModel contract below is the camelCase `userDecryption` field.
    UserDecryption: {
      MasterPasswordUnlock: userDecryptionOptions.MasterPasswordUnlock,
      TrustedDeviceOption: null,
      KeyConnectorOption: null,
      WebAuthnPrfOption: firstPrfOption,
      WebAuthnPrfOptions: webAuthnPrfOptions,
      V2UpgradeToken: null,
      Object: "userDecryption",
    },
    UserDecryptionOptions: userDecryptionOptions,
    userDecryptionOptions,
    userDecryption: buildUserDecryptionCompat(user, webAuthnPrfOptions),
    object: "sync",
  };
}

// GET /api/sync
export const sync = factory.createHandlers(async (c) => {
  const db = c.get("db");
  const userId = c.get("user").id;
  const excludeDomains = c.req.query("excludeDomains") === "true";
  const payload = await readAtStableRevision({
    readRevision: () => getRevisionValue(db, userId),
    read: () => buildSyncPayload(c, excludeDomains),
  });
  if (!payload) {
    return c.json(
      {
        message: "Vault changed repeatedly while synchronizing; retry",
        object: "error",
      },
      503,
      { "Retry-After": "1" },
    );
  }
  return c.json(payload);
});
