import * as m from "$lib/paraglide/messages.js";
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
  updateCipherCollectionsApi,
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
    throw new Error(
      m.ui_select_at_least_one_collection_for_an_organization_item(),
    );
  }
  const ownerKey = resolveOwnerKey(editor.organizationId);
  if (!ownerKey)
    throw new Error(m.ui_keys_are_not_ready_unlock_your_vault_again());
  const ownershipChanged =
    Boolean(selectedItem) &&
    (selectedItem?.organizationId ?? null) !== editor.organizationId;
  if (ownershipChanged && selectedItem?.key) {
    const sourceOwnerKey = resolveOwnerKey(selectedItem.organizationId);
    if (!sourceOwnerKey)
      throw new Error(m.ui_the_original_owner_s_key_is_unavailable());
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
  if (isEditing && selectedItem) {
    const saved = await updateCipherApi(selectedItem.id, encryptedPayload);
    // The update endpoint leaves organization collection links untouched, so
    // assignment edits go through the dedicated collections endpoint. The
    // inline collectionIds above only apply when sharing moves the item into
    // an organization.
    if (
      !ownershipChanged &&
      selectedItem.organizationId &&
      !sameCollectionIds(
        selectedItem.collectionIds ?? [],
        editor.collectionIds,
      )
    ) {
      await updateCipherCollectionsApi(
        selectedItem.id,
        editor.collectionIds,
      );
    }
    return saved;
  }
  throw new Error(m.ui_no_vault_items_to_save());
}

function sameCollectionIds(
  current: readonly string[],
  next: readonly string[],
) {
  return (
    current.length === next.length && current.every((id) => next.includes(id))
  );
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
  if (item.readOnly)
    throw new Error(m.ui_this_organization_item_is_read_only());
  const ownerKey = resolveOwnerKey(item.organizationId);
  if (!ownerKey) throw new Error(m.ui_vault_key_is_unavailable());
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
    throw new Error(m.ui_the_selection_includes_read_only_organization_items());
  }
  const personalIds = items
    .filter((item) => !item.organizationId)
    .map((item) => item.id);
  if (personalIds.length) await bulkPersonalActions[action](personalIds);
  for (const item of items.filter((cipher) => cipher.organizationId)) {
    await singleCipherActions[action](item.id);
  }
}
