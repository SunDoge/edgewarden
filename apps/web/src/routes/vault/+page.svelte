<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { CipherType } from "@edgewarden/shared";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { match } from "ts-pattern";
  import { page } from "$app/state";
  import VaultDetailPanel from "$lib/components/vault/VaultDetailPanel.svelte";
  import VaultDialogs from "$lib/components/vault/VaultDialogs.svelte";
  import VaultItemList from "$lib/components/vault/VaultItemList.svelte";
  import VaultNavigation from "$lib/components/vault/VaultNavigation.svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { calcTotpNow } from "$lib/services/crypto";
  import type { VaultBulkAction } from "$lib/services/vault-cipher-actions";
  import {
    type DuplicateMode,
    filterAndSortVaultItems,
    findDuplicateCipherGroups,
    findDuplicateCipherIds,
    type VaultCategory,
    type VaultSort,
  } from "$lib/services/vault-filter";
  import {
    findDuplicateFolderGroups,
    mergeDuplicateVaultFolders,
  } from "$lib/services/vault-folder-actions";
  import type { VaultAttachment } from "$lib/services/vault-types";
  import { createVaultFolderManager } from "$lib/services/vault-folder-manager.svelte";
  import { createVaultAttachmentManager } from "$lib/services/vault-attachment-manager.svelte";
  import { createVaultBulkManager } from "$lib/services/vault-bulk-manager.svelte";
  import { createVaultItemManager } from "$lib/services/vault-item-manager.svelte";
  import { syncVaultData, vault } from "$lib/stores/vault.svelte";

  // UI state
  let searchQuery = $state("");
  let activeCategory = $state<VaultCategory>("all");
  let activeFolder = $state<string | null>(null);
  let sortMode = $state<VaultSort>("edited");
  let duplicateMode = $state<DuplicateMode>("exact");
  let totpLive = $state<{ code: string; remain: number } | null>(null);
  let mobileSidebarOpen = $state(false);
  let mobileDetailOpen = $state(false);
  let pendingConfirmation = $state<
    | { kind: "merge-folders" }
    | { kind: "delete-attachment"; attachment: VaultAttachment }
    | { kind: "bulk"; action: VaultBulkAction }
    | null
  >(null);

  let mergingDuplicateFolders = $state(false);

  const folderManager = createVaultFolderManager({
    get: () => activeFolder,
    set: (value) => (activeFolder = value),
  });

  const itemManager = createVaultItemManager({
    activeFolder: () => activeFolder,
    openDetail: () => (mobileDetailOpen = true),
    closeDetail: () => (mobileDetailOpen = false),
  });
  const itemState = itemManager.state;

  const attachmentManager = createVaultAttachmentManager({
    selected: () => itemState.selected,
    select: itemManager.select,
    confirmDelete: (attachment) => {
      pendingConfirmation = { kind: "delete-attachment", attachment };
    },
  });

  const bulkManager = createVaultBulkManager({
    duplicateMode: () => duplicateMode,
    clearSelectedItem: () => itemManager.select(null),
    confirm: (action) => {
      pendingConfirmation = { kind: "bulk", action };
    },
    resolveOwnerKey: itemManager.resolveOwnerKey,
  });

  async function updateTotp() {
    if (itemState.selected?.type === CipherType.Login && itemState.selected.login?.totp) {
      try {
        const res = await calcTotpNow(itemState.selected.login.totp);
        totpLive = res;
      } catch {
        totpLive = null;
      }
    } else {
      totpLive = null;
    }
  }

  $effect(() => {
    itemState.selected;
    updateTotp();

    const interval = window.setInterval(() => {
      updateTotp();
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  });

  onMount(async () => {
    const requestedCipherId = page.url.searchParams.get("cipher");
    if (requestedCipherId) {
      itemManager.select(vault.ciphers.find((cipher) => cipher.id === requestedCipherId) ?? null);
    }
  });

  // Derived filtering
  let filteredItems = $derived(
    filterAndSortVaultItems(vault.ciphers, {
      category: activeCategory,
      folderId: activeFolder,
      query: searchQuery,
      sort: sortMode,
      duplicateMode,
    }),
  );
  let duplicateCount = $derived(findDuplicateCipherIds(vault.ciphers, duplicateMode).size);
  let duplicateGroupCount = $derived(
    findDuplicateCipherGroups(vault.ciphers, duplicateMode).length,
  );
  let duplicateFolderCount = $derived(
    findDuplicateFolderGroups(vault.folders).reduce((count, group) => count + group.length - 1, 0),
  );

  async function mergeDuplicateFolders() {
    if (!duplicateFolderCount) return;
    pendingConfirmation = { kind: "merge-folders" };
  }

  async function executeMergeDuplicateFolders() {
    mergingDuplicateFolders = true;
    try {
      const result = await mergeDuplicateVaultFolders(vault.folders, vault.ciphers);
      activeFolder = null;
      await syncVaultData();
      toast.success(
        m.ui_merged_folders_value_moved_items_value({
          value0: result.mergedFolders,
          value1: result.movedItems,
        }),
      );
    } catch (error) {
      toast.error(
        m.ui_unable_to_merge_duplicate_folders_value({
          value0: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      mergingDuplicateFolders = false;
    }
  }

  async function confirmPendingAction() {
    if (!pendingConfirmation) return;
    const pending = pendingConfirmation;
    pendingConfirmation = null;
    await match(pending)
      .with({ kind: "merge-folders" }, () => executeMergeDuplicateFolders())
      .with({ kind: "delete-attachment" }, ({ attachment }) => attachmentManager.remove(attachment))
      .with({ kind: "bulk" }, ({ action }) => bulkManager.execute(action))
      .exhaustive();
  }

  function pendingConfirmationText(): string {
    return match(pendingConfirmation)
      .with({ kind: "merge-folders" }, () =>
        m.ui_merge_value_duplicate_folders_items_will_move_to_the_most_recently_modified_fold({
          value0: duplicateFolderCount,
        }),
      )
      .with({ kind: "delete-attachment" }, ({ attachment }) =>
        m.ui_delete_attachment_value({ value0: attachment.fileName }),
      )
      .with({ kind: "bulk", action: "permanent" }, () =>
        m.ui_permanently_delete_value_selected_items_this_cannot_be_undone({
          value0: bulkManager.count,
        }),
      )
      .with({ kind: "bulk" }, () =>
        m.ui_move_value_selected_items_to_the_trash({ value0: bulkManager.count }),
      )
      .otherwise(() => m.ui_please_confirm_this_action());
  }
</script>

<svelte:head>
  <title>{m.ui_my_vault_edgewarden()}</title>
</svelte:head>

<div class="relative flex h-full overflow-hidden">
  <VaultNavigation
    bind:mobileOpen={mobileSidebarOpen}
    bind:activeCategory
    bind:activeFolder
    {duplicateCount}
    {duplicateFolderCount}
    {mergingDuplicateFolders}
    onCreate={itemManager.startCreate}
    onCreateFolder={folderManager.openCreate}
    onRenameFolder={folderManager.openRename}
    onDeleteFolder={folderManager.openDelete}
    onDeleteAllFolders={() => (folderManager.deleteAllDialogOpen = true)}
    onMergeDuplicateFolders={mergeDuplicateFolders}
  />

  <div class="flex min-w-0 flex-1 {mobileDetailOpen ? 'hidden md:flex' : 'flex'}">
    <VaultItemList
      items={filteredItems}
      isSyncing={vault.isSyncing}
      error={vault.error}
      {activeCategory}
      {duplicateGroupCount}
      bind:searchQuery
      bind:duplicateMode
      bind:sortMode
      bind:selectedItem={itemState.selected}
      selectedIds={bulkManager.selectedIds}
      selectedCount={bulkManager.count}
      onToggleSelection={bulkManager.toggle}
      onBulkAction={bulkManager.run}
      onClearSelection={bulkManager.clear}
      onSelectRedundant={bulkManager.selectRedundant}
      onMove={bulkManager.openMove}
      onSelectItem={() => (mobileDetailOpen = true)}
      onOpenFilters={() => (mobileSidebarOpen = true)}
    />
  </div>

  <VaultDetailPanel
    visible={mobileDetailOpen}
    isCreating={itemState.isCreating}
    isEditing={itemState.isEditing}
    bind:editor={itemState.editor}
    selectedItem={itemState.selected}
    folders={vault.folders}
    organizations={vault.organizations}
    collections={vault.collections}
    totp={totpLive}
    attachmentBusy={attachmentManager.busy}
    cloneBusy={itemState.busy}
    isSyncing={vault.isSyncing}
    onBack={() => {
      if (itemState.isCreating || itemState.isEditing) itemManager.cancelEdit();
      else mobileDetailOpen = false;
    }}
    onSave={itemManager.save}
    onDelete={itemManager.requestDelete}
    onCancel={itemManager.cancelEdit}
    onFavorite={itemManager.toggleFavorite}
    onArchive={itemManager.toggleArchive}
    onRestore={itemManager.restore}
    onEdit={itemManager.startEdit}
    onCloneToPersonal={itemManager.cloneToPersonal}
    onAttachmentUpload={attachmentManager.upload}
    onAttachmentDownload={attachmentManager.download}
    onAttachmentDelete={attachmentManager.requestDelete}
  />
</div>

<VaultDialogs
  bind:deleteOpen={itemState.deleteDialogOpen}
  bind:deleteAllFoldersOpen={folderManager.deleteAllDialogOpen}
  bind:moveOpen={bulkManager.moveDialogOpen}
  bind:folderOpen={folderManager.dialogOpen}
  bind:deleteFolderOpen={folderManager.deleteDialogOpen}
  bind:moveFolderId={bulkManager.moveFolderId}
  bind:folderName={folderManager.dialogName}
  selectedItemName={itemState.selected?.name}
  selectedItemDeleted={!!itemState.selected?.deletedDate}
  deleteLoading={itemState.busy || bulkManager.busy}
  folders={vault.folders}
  selectedCount={bulkManager.count}
  folderMode={folderManager.dialogMode}
  folderLoading={folderManager.dialogLoading || folderManager.deleteLoading}
  targetFolderName={folderManager.target?.name}
  onDeleteItem={itemManager.confirmDelete}
  onDeleteAllFolders={folderManager.removeAll}
  onMoveItems={bulkManager.move}
  onSaveFolder={folderManager.save}
  onDeleteFolder={folderManager.remove}
/>

<AlertDialog.Root
  open={pendingConfirmation !== null}
  onOpenChange={(open) => {
    if (!open) pendingConfirmation = null;
  }}
>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_confirm_action()}</AlertDialog.Title><AlertDialog.Description
        >{pendingConfirmationText()}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={confirmPendingAction}>{m.ui_confirm()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>
