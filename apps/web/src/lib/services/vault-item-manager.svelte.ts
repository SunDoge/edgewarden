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
      toast.error(m.ui_this_organization_item_is_read_only());
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
      toast.error(m.ui_unable_to_save_value({ value0: errorDetail(caught) }));
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
      toast.error(m.ui_this_organization_item_is_read_only());
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
      toast.error(m.ui_unable_to_delete_value({ value0: errorDetail(caught) }));
    } finally {
      state.busy = false;
    }
  }

  async function restore() {
    if (!state.selected?.deletedDate) return;
    if (state.selected.readOnly) {
      toast.error(m.ui_this_organization_item_is_read_only());
      return;
    }
    state.busy = true;
    try {
      await restoreCipherApi(state.selected.id);
      state.selected = null;
      await syncVaultData();
    } catch (caught) {
      toast.error(
        m.ui_unable_to_restore_value({ value0: errorDetail(caught) }),
      );
    } finally {
      state.busy = false;
    }
  }

  async function toggleArchive() {
    if (!state.selected || state.selected.deletedDate) return;
    if (state.selected.readOnly) {
      toast.error(m.ui_this_organization_item_is_read_only());
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
      toast.error(
        m.ui_unable_to_change_archive_state_value({
          value0: errorDetail(caught),
        }),
      );
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
      toast.error(
        m.ui_unable_to_change_favorite_state_value({
          value0: errorDetail(caught),
        }),
      );
    } finally {
      state.busy = false;
    }
  }

  async function cloneToPersonal() {
    const item = state.selected;
    if (!item?.organizationId || item.hidePasswords) return;
    const personalKeys = resolveOwnerKey(null);
    if (!personalKeys) {
      toast.error(
        m.ui_personal_vault_key_is_unavailable_unlock_your_vault_again(),
      );
      return;
    }
    state.busy = true;
    try {
      const created = await cloneVaultCipherToPersonal(item, personalKeys);
      await syncVaultData();
      state.selected =
        vault.ciphers.find((cipher) => cipher.id === created.id) ?? null;
      toast.success(
        m.ui_saved_to_your_personal_vault_the_organization_original_is_unchanged(),
      );
    } catch (caught) {
      toast.error(
        m.ui_unable_to_save_a_personal_copy_value({
          value0: errorDetail(caught),
        }),
      );
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
