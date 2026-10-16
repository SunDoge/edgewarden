import * as m from "$lib/paraglide/messages.js";
import {
  createFolderApi,
  deleteFolderApi,
  deleteFoldersApi,
  updateFolderApi,
} from "$lib/services/api-folders";
import { moveCiphersApi } from "$lib/services/api-vault";
import { encryptStr } from "$lib/services/crypto";

export type FolderEditorMode = "create" | "rename";

export async function saveVaultFolder({
  mode,
  name,
  folderId,
  encKey,
  macKey,
}: {
  mode: FolderEditorMode;
  name: string;
  folderId?: string;
  encKey?: Uint8Array | null;
  macKey?: Uint8Array | null;
}) {
  const normalizedName = name.trim();
  if (!normalizedName) return;
  if (!encKey || !macKey)
    throw new Error(m.ui_keys_are_not_ready_unlock_your_vault_again());
  const encryptedName = await encryptStr(normalizedName, encKey, macKey);
  if (mode === "create") await createFolderApi({ name: encryptedName });
  else if (folderId) await updateFolderApi(folderId, { name: encryptedName });
  else throw new Error(m.ui_the_folder_to_rename_could_not_be_found());
}

export async function removeVaultFolder(folderId: string) {
  await deleteFolderApi(folderId);
}

export async function removeAllVaultFolders(folders: Array<{ id: string }>) {
  if (folders.length)
    await deleteFoldersApi(folders.map((folder) => folder.id));
}

interface MergeFolder {
  id: string;
  name: string;
  revisionDate?: string;
}

export function findDuplicateFolderGroups(
  folders: MergeFolder[],
): MergeFolder[][] {
  const groups = new Map<string, MergeFolder[]>();
  for (const folder of folders) {
    const key = folder.name.normalize("NFC").trim();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), folder]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export async function mergeDuplicateVaultFolders(
  folders: MergeFolder[],
  ciphers: Array<{
    id: string;
    folderId: string | null;
    deletedDate?: string | null;
    organizationId?: string | null;
  }>,
): Promise<{ mergedFolders: number; movedItems: number }> {
  const redundantFolderIds: string[] = [];
  let movedItems = 0;
  for (const group of findDuplicateFolderGroups(folders)) {
    const [keeper, ...redundant] = group.toSorted((left, right) => {
      const leftDate = Date.parse(left.revisionDate ?? "") || 0;
      const rightDate = Date.parse(right.revisionDate ?? "") || 0;
      return rightDate - leftDate || left.id.localeCompare(right.id);
    });
    const redundantIds = new Set(redundant.map((folder) => folder.id));
    const cipherIds = ciphers
      .filter(
        (cipher) =>
          !cipher.deletedDate &&
          !cipher.organizationId &&
          cipher.folderId != null &&
          redundantIds.has(cipher.folderId),
      )
      .map((cipher) => cipher.id);
    await moveCiphersApi(cipherIds, keeper.id);
    movedItems += cipherIds.length;
    redundantFolderIds.push(...redundantIds);
  }
  await deleteFoldersApi(redundantFolderIds);
  return { mergedFolders: redundantFolderIds.length, movedItems };
}
