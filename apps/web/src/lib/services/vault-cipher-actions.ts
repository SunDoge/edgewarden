import type { VaultEditorForm } from "$lib/services/vault-editor";
import {
  archiveCipherApi,
  archiveCiphersApi,
  createCipherApi,
  deleteCipherApi,
  deleteCiphersApi,
  hardDeleteCipherApi,
  hardDeleteCiphersApi,
  restoreCipherApi,
  restoreCiphersApi,
  unarchiveCipherApi,
  unarchiveCiphersApi,
  updateCipherApi,
} from "$lib/services/api-vault";
import { encryptCipher, rewrapCipherKey } from "$lib/services/cipher-crypto";
import { buildCipherPayload } from "$lib/services/cipher-draft";
import { vaultCipherToEditorForm } from "$lib/services/vault-editor";
import {
  downloadVaultAttachment,
  uploadVaultAttachment,
} from "$lib/services/vault-attachments";
import type { VaultCipher } from "$lib/services/vault-types";

export type CipherOwnerKey = { encKey: Uint8Array; macKey: Uint8Array };
export type CipherOwnerKeyResolver = (
  organizationId?: string | null,
) => CipherOwnerKey | null;
export type VaultBulkAction =
  | "delete"
  | "restore"
  | "permanent"
  | "archive"
  | "unarchive";
export type VaultActionItem = Pick<VaultCipher, "id"> &
  Partial<Pick<VaultCipher, "organizationId" | "readOnly">>;

export async function saveVaultCipher({
  editor,
  selectedItem,
  isCreating,
  isEditing,
  resolveOwnerKey,
}: {
  editor: VaultEditorForm;
  selectedItem: VaultCipher | null;
  isCreating: boolean;
  isEditing: boolean;
  resolveOwnerKey: CipherOwnerKeyResolver;
}) {
  const payload = buildCipherPayload(
    {
      type: editor.type,
      name: editor.name,
      notes: editor.notes,
      favorite: editor.favorite,
      folderId: editor.folderId,
      login: {
        username: editor.loginUsername,
        password: editor.loginPassword,
        uri: editor.loginUri,
        uris: editor.loginUris,
        totp: editor.loginTotp,
      },
      card: {
        cardholderName: editor.cardholderName,
        number: editor.cardNumber,
      },
      identity: {
        firstName: editor.firstName,
        lastName: editor.lastName,
        number: editor.identityNumber,
      },
      customFields: editor.customFields,
      extraData: editor.extraData,
    },
    selectedItem,
    isEditing,
  );
  if (editor.organizationId && !editor.collectionIds.length) {
    throw new Error("组织条目至少需要选择一个集合");
  }
  const ownerKey = resolveOwnerKey(editor.organizationId);
  if (!ownerKey) throw new Error("密钥未就绪，请重新解锁保险库");
  const ownershipChanged =
    Boolean(selectedItem) &&
    (selectedItem?.organizationId ?? null) !== editor.organizationId;
  if (ownershipChanged && selectedItem?.key) {
    const sourceOwnerKey = resolveOwnerKey(selectedItem.organizationId);
    if (!sourceOwnerKey) throw new Error("原所有者密钥不可用");
    payload.key = await rewrapCipherKey(
      selectedItem.key,
      sourceOwnerKey.encKey,
      sourceOwnerKey.macKey,
      ownerKey.encKey,
      ownerKey.macKey,
    );
  }
  const encryptedPayload = await encryptCipher(
    {
      ...payload,
      folderId: editor.organizationId ? null : payload.folderId,
      organizationId: editor.organizationId,
      collectionIds: editor.organizationId ? editor.collectionIds : [],
    },
    ownerKey.encKey,
    ownerKey.macKey,
  );
  if (isCreating) return createCipherApi(encryptedPayload);
  if (isEditing && selectedItem)
    return updateCipherApi(selectedItem.id, encryptedPayload);
  throw new Error("没有可保存的保险库条目");
}

export async function cloneVaultCipherToPersonal(
  item: VaultCipher,
  personalKeys: CipherOwnerKey,
) {
  const editor = vaultCipherToEditorForm(item);
  const payload = buildCipherPayload(
    {
      type: editor.type,
      name: editor.name,
      notes: editor.notes,
      favorite: editor.favorite,
      folderId: null,
      login: {
        username: editor.loginUsername,
        password: editor.loginPassword,
        uri: editor.loginUri,
        uris: editor.loginUris,
        totp: editor.loginTotp,
      },
      card: {
        cardholderName: editor.cardholderName,
        number: editor.cardNumber,
      },
      identity: {
        firstName: editor.firstName,
        lastName: editor.lastName,
        number: editor.identityNumber,
      },
      customFields: editor.customFields,
      extraData: editor.extraData,
    },
    item,
    false,
  );
  const encrypted = await encryptCipher(
    {
      ...payload,
      key: null,
      folderId: null,
      organizationId: null,
      collectionIds: [],
    },
    personalKeys.encKey,
    personalKeys.macKey,
  );
  const created = await createCipherApi(encrypted);
  try {
    for (const attachment of item.attachments ?? []) {
      const downloaded = await downloadVaultAttachment(item.id, attachment);
      const bytes = downloaded.bytes.buffer.slice(
        downloaded.bytes.byteOffset,
        downloaded.bytes.byteOffset + downloaded.bytes.byteLength,
      ) as ArrayBuffer;
      await uploadVaultAttachment(
        created,
        new File([bytes], downloaded.fileName),
        personalKeys,
      );
    }
  } catch (error) {
    await hardDeleteCipherApi(created.id).catch(() => undefined);
    throw error;
  }
  return created;
}

export async function updateEncryptedVaultCipher(
  item: VaultCipher,
  changes: Record<string, unknown>,
  resolveOwnerKey: CipherOwnerKeyResolver,
) {
  if (item.readOnly) throw new Error("该组织条目为只读");
  const ownerKey = resolveOwnerKey(item.organizationId);
  if (!ownerKey) throw new Error("保险库密钥不可用");
  const encrypted = await encryptCipher(
    { ...item, ...changes },
    ownerKey.encKey,
    ownerKey.macKey,
  );
  await updateCipherApi(item.id, encrypted);
}

const bulkPersonalActions = {
  delete: deleteCiphersApi,
  restore: restoreCiphersApi,
  permanent: hardDeleteCiphersApi,
  archive: archiveCiphersApi,
  unarchive: unarchiveCiphersApi,
} satisfies Record<VaultBulkAction, (ids: string[]) => Promise<unknown>>;

const singleCipherActions = {
  delete: deleteCipherApi,
  restore: restoreCipherApi,
  permanent: hardDeleteCipherApi,
  archive: archiveCipherApi,
  unarchive: unarchiveCipherApi,
} satisfies Record<VaultBulkAction, (id: string) => Promise<unknown>>;

export async function applyVaultBulkAction(
  action: VaultBulkAction,
  items: VaultActionItem[],
) {
  if (items.some((item) => item.readOnly)) {
    throw new Error("选择中包含只读组织条目");
  }
  const personalIds = items
    .filter((item) => !item.organizationId)
    .map((item) => item.id);
  if (personalIds.length) await bulkPersonalActions[action](personalIds);
  for (const item of items.filter((cipher) => cipher.organizationId)) {
    await singleCipherActions[action](item.id);
  }
}
