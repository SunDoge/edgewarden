import type {
  CipherResponse,
  CollectionResponse,
  FolderResponse,
  ProfileOrganizationResponse,
  SyncResponse,
} from "@edgewarden/shared";
import { decryptCipher } from "./cipher-crypto";
import { decryptStr } from "./crypto";
import {
  importAccountPrivateKey,
  unwrapOrganizationKey,
} from "./organization-crypto";
import { decryptOwnedSend, type DecryptedSend } from "./send-crypto";
import type { VaultSnapshot } from "./vault-db";
import type { VaultCipher } from "./vault-types";
import type { EncryptedOwnedSend } from "./send-types";

export interface VaultKeyPair {
  encKey: Uint8Array;
  macKey: Uint8Array;
}

export interface HydratedVaultSnapshot {
  ciphers: VaultCipher[];
  folders: FolderResponse[];
  collections: CollectionResponse[];
  organizations: ProfileOrganizationResponse[];
  sends: DecryptedSend[];
  profile: SyncResponse["profile"];
  syncedAt: number;
  organizationKeys: Map<string, VaultKeyPair>;
  warning: string | null;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function mapConcurrent<T, R>(
  values: readonly T[],
  mapper: (value: T) => Promise<R>,
  concurrency = 12,
): Promise<Settled<R>[]> {
  const results = new Array<Settled<R>>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await mapper(values[index]) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

export function applyOrganizationAccess(
  ciphers: CipherResponse[],
  collections: Array<{
    id: string;
    organizationId?: string;
    readOnly?: boolean;
    hidePasswords?: boolean;
  }>,
): VaultCipher[] {
  const visible = new Map(
    collections.map((collection) => [String(collection.id), collection]),
  );
  return ciphers.map((cipher) => {
    if (!cipher.organizationId) return cipher as VaultCipher;
    const ids = cipher.collectionIds ?? [];
    const access = ids
      .map((id) => visible.get(id))
      .filter((collection) => collection !== undefined);
    const readOnly =
      !ids.length ||
      access.length !== ids.length ||
      access.some((collection) => Boolean(collection.readOnly));
    const hidePasswords =
      access.length > 0 &&
      access.every((collection) => Boolean(collection.hidePasswords));
    return { ...cipher, readOnly, hidePasswords } as VaultCipher;
  });
}

async function unwrapOrganizationKeys(
  profile: SyncResponse["profile"],
  userKeys: VaultKeyPair,
  warnings: string[],
): Promise<Map<string, VaultKeyPair>> {
  const keys = new Map<string, VaultKeyPair>();
  const organizations = profile.organizations ?? [];
  if (!organizations.length) return keys;
  if (!profile.privateKey) throw new Error("Account private key unavailable");
  const privateKey = await importAccountPrivateKey(
    profile.privateKey,
    userKeys.encKey,
    userKeys.macKey,
  );
  let failures = 0;
  for (const organization of organizations) {
    try {
      if (!organization.id || !organization.key)
        throw new Error("Missing member key");
      keys.set(
        organization.id,
        await unwrapOrganizationKey(organization.key, privateKey),
      );
    } catch (error) {
      console.error(
        "Failed to unwrap organization key",
        organization.id,
        error,
      );
      failures++;
    }
  }
  if (failures)
    warnings.push(`${failures} 个组织密钥无法解封，相关条目已隔离。`);
  return keys;
}

export async function hydrateEncryptedVaultSnapshot(
  snapshot: Omit<VaultSnapshot, "accountId">,
  userKeys: VaultKeyPair,
): Promise<HydratedVaultSnapshot> {
  const warnings: string[] = [];
  const organizationKeys = await unwrapOrganizationKeys(
    snapshot.profile,
    userKeys,
    warnings,
  );

  const cipherResults = await mapConcurrent(
    snapshot.ciphers,
    async (cipher) => {
      const keys = cipher.organizationId
        ? organizationKeys.get(cipher.organizationId)
        : userKeys;
      if (!keys) throw new Error("Organization key unavailable");
      return decryptCipher(cipher, keys.encKey, keys.macKey);
    },
  );
  const ciphers: VaultCipher[] = [];
  let cipherFailures = 0;
  for (const [index, result] of cipherResults.entries()) {
    if (result.ok) ciphers.push(result.value);
    else {
      console.error(
        "Failed to decrypt cipher:",
        snapshot.ciphers[index].id,
        result.error,
      );
      cipherFailures += 1;
    }
  }
  if (cipherFailures)
    warnings.push(
      `${cipherFailures} 个保险库条目未通过完整性校验，已从当前会话隔离。`,
    );

  const folderResults = await mapConcurrent(
    snapshot.folders,
    async (folder) => ({
      ...folder,
      name: await decryptStr(folder.name, userKeys.encKey, userKeys.macKey),
    }),
  );
  const folders: FolderResponse[] = [];
  let folderFailures = 0;
  for (const [index, result] of folderResults.entries()) {
    if (result.ok) folders.push(result.value);
    else {
      console.error(
        "Failed to decrypt folder:",
        snapshot.folders[index].id,
        result.error,
      );
      folderFailures += 1;
    }
  }
  if (folderFailures)
    warnings.push(
      `${folderFailures} 个文件夹未通过完整性校验，已从当前会话隔离。`,
    );

  const collections: CollectionResponse[] = [];
  let collectionFailures = 0;
  for (const collection of snapshot.collections ?? []) {
    try {
      const keys = organizationKeys.get(collection.organizationId);
      if (!keys) throw new Error("Organization key unavailable");
      collections.push({
        ...collection,
        name: await decryptStr(collection.name, keys.encKey, keys.macKey),
      });
    } catch (error) {
      console.error("Failed to decrypt collection", collection.id, error);
      collectionFailures++;
    }
  }
  if (collectionFailures)
    warnings.push(`${collectionFailures} 个集合未通过完整性校验，已隔离。`);

  const encryptedSends = snapshot.sends ?? [];
  const sendResults = await mapConcurrent(encryptedSends, (send) =>
    decryptOwnedSend(
      send as EncryptedOwnedSend,
      userKeys.encKey,
      userKeys.macKey,
    ),
  );
  const sends: DecryptedSend[] = [];
  let sendFailures = 0;
  for (const result of sendResults) {
    if (result.ok) sends.push(result.value);
    else {
      console.error("Failed to decrypt Send:", result.error);
      sendFailures += 1;
    }
  }
  if (sendFailures)
    warnings.push(`${sendFailures} 个 Send 未通过完整性校验，已隔离。`);

  return {
    ciphers: applyOrganizationAccess(ciphers, collections),
    folders,
    collections,
    organizations: snapshot.profile.organizations ?? [],
    sends,
    profile: snapshot.profile,
    syncedAt: snapshot.syncedAt,
    organizationKeys,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}
