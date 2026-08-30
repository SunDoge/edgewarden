import { toast } from "svelte-sonner";
import { formatTime } from "$lib/i18n/format";
import { m } from "$lib/paraglide/messages.js";
import {
  archiveCipherApi,
  deleteCipherApi,
  hardDeleteCipherApi,
  restoreCipherApi,
  unarchiveCipherApi,
} from "./api-vault";
import {
  cloneVaultCipherToPersonal,
  saveVaultCipher,
  updateEncryptedVaultCipher,
  type CipherOwnerKeyResolver,
} from "./vault-cipher-actions";
import {
  createVaultEditorForm,
  vaultCipherToEditorForm,
  type VaultEditorForm,
} from "./vault-editor";
import type { VaultCipher } from "./vault-types";
import { errorDetail } from "./error-message";
import {
  getOrganizationKey,
  syncVaultData,
  vault,
} from "$lib/stores/vault.svelte";

interface VaultItemManagerState {
  selected: VaultCipher | null;
  isEditing: boolean;
  isCreating: boolean;
  editor: VaultEditorForm;
  deleteDialogOpen: boolean;
  busy: boolean;
}

export function createVaultItemManager(options: {
  activeFolder(): string | null;
  openDetail(): void;
  closeDetail(): void;
}) {
  const state = $state<VaultItemManagerState>({
    selected: null,
    isEditing: false,
    isCreating: false,
    editor: createVaultEditorForm(),
    deleteDialogOpen: false,
    busy: false,
  });

  const resolveOwnerKey: CipherOwnerKeyResolver = (organizationId) =>
    organizationId
      ? getOrganizationKey(organizationId)
      : vault.symEncKey && vault.symMacKey
        ? { encKey: vault.symEncKey, macKey: vault.symMacKey }
        : null;

  function select(cipher: VaultCipher | null) {
    state.selected = cipher;
  }

  function startCreate() {
    state.selected = null;
    state.isEditing = false;
    state.isCreating = true;
    options.openDetail();
    state.editor = createVaultEditorForm(options.activeFolder());
  }

  function startEdit() {
    if (!state.selected) return;
    if (state.selected.readOnly) {
      toast.error("该组织条目为只读");
      return;
    }
    state.isCreating = false;
    state.isEditing = true;
    options.openDetail();
    state.editor = vaultCipherToEditorForm(state.selected);
  }

  function cancelEdit() {
    state.isCreating = false;
    if (!state.selected) options.closeDetail();
    state.isEditing = false;
  }

  async function save() {
    let saved: Awaited<ReturnType<typeof saveVaultCipher>>;
    try {
      saved = await saveVaultCipher({
        editor: state.editor,
        selectedItem: state.selected,
        isCreating: state.isCreating,
        isEditing: state.isEditing,
        resolveOwnerKey,
      });
    } catch (caught) {
      toast.error(`保存失败：${errorDetail(caught)}`);
      return;
    }

    toast.success(
      m.vault_saved_to_server({ time: formatTime(saved.revisionDate) }),
    );
    state.isCreating = false;
    state.isEditing = false;
    state.selected = null;
    try {
      await syncVaultData();
    } catch {
      // The mutation acknowledgement remains authoritative when refresh fails.
    }
    if (vault.isOffline || vault.status === "error")
      toast.warning(m.vault_saved_refresh_failed());
  }

  function requestDelete() {
    if (!state.selected) return;
    if (state.selected.readOnly) {
      toast.error("该组织条目为只读");
      return;
    }
    state.deleteDialogOpen = true;
  }

  async function confirmDelete() {
    if (!state.selected) return;
    state.busy = true;
    try {
      if (state.selected.deletedDate)
        await hardDeleteCipherApi(state.selected.id);
      else await deleteCipherApi(state.selected.id);
      state.deleteDialogOpen = false;
      state.selected = null;
      state.isEditing = false;
      await syncVaultData();
    } catch (caught) {
      toast.error(`删除失败：${errorDetail(caught)}`);
    } finally {
      state.busy = false;
    }
  }

  async function restore() {
    if (!state.selected?.deletedDate) return;
    if (state.selected.readOnly) {
      toast.error("该组织条目为只读");
      return;
    }
    state.busy = true;
    try {
      await restoreCipherApi(state.selected.id);
      state.selected = null;
      await syncVaultData();
    } catch (caught) {
      toast.error(`恢复失败：${errorDetail(caught)}`);
    } finally {
      state.busy = false;
    }
  }

  async function toggleArchive() {
    if (!state.selected || state.selected.deletedDate) return;
    if (state.selected.readOnly) {
      toast.error("该组织条目为只读");
      return;
    }
    state.busy = true;
    try {
      if (state.selected.archivedDate)
        await unarchiveCipherApi(state.selected.id);
      else await archiveCipherApi(state.selected.id);
      state.selected = null;
      await syncVaultData();
    } catch (caught) {
      toast.error(`归档操作失败：${errorDetail(caught)}`);
    } finally {
      state.busy = false;
    }
  }

  async function toggleFavorite() {
    const item = state.selected;
    if (!item) return;
    state.busy = true;
    try {
      await updateEncryptedVaultCipher(
        item,
        { favorite: !item.favorite },
        resolveOwnerKey,
      );
      await syncVaultData();
      state.selected =
        vault.ciphers.find((cipher) => cipher.id === item.id) ?? null;
    } catch (caught) {
      toast.error(`收藏操作失败：${errorDetail(caught)}`);
    } finally {
      state.busy = false;
    }
  }

  async function cloneToPersonal() {
    const item = state.selected;
    if (!item?.organizationId || item.hidePasswords) return;
    const personalKeys = resolveOwnerKey(null);
    if (!personalKeys) {
      toast.error("个人保险库密钥不可用，请重新解锁");
      return;
    }
    state.busy = true;
    try {
      const created = await cloneVaultCipherToPersonal(item, personalKeys);
      await syncVaultData();
      state.selected =
        vault.ciphers.find((cipher) => cipher.id === created.id) ?? null;
      toast.success("已保存到个人保险库，组织原件保持不变");
    } catch (caught) {
      toast.error(`保存个人副本失败：${errorDetail(caught)}`);
    } finally {
      state.busy = false;
    }
  }

  return {
    state,
    select,
    resolveOwnerKey,
    startCreate,
    startEdit,
    cancelEdit,
    save,
    requestDelete,
    confirmDelete,
    restore,
    toggleArchive,
    toggleFavorite,
    cloneToPersonal,
  };
}
