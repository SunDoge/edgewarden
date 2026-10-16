<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import VaultSidebar from "./VaultSidebar.svelte";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import type { VaultCategory } from "$lib/services/vault-filter";
  import type { VaultFolder } from "$lib/services/vault-types";

  let {
    mobileOpen = $bindable(false),
    activeCategory = $bindable<VaultCategory>("all"),
    activeFolder = $bindable<string | null>(null),
    duplicateCount,
    duplicateFolderCount,
    mergingDuplicateFolders,
    onCreate,
    onCreateFolder,
    onRenameFolder,
    onDeleteFolder,
    onDeleteAllFolders,
    onMergeDuplicateFolders,
  }: {
    mobileOpen: boolean;
    activeCategory: VaultCategory;
    activeFolder: string | null;
    duplicateCount: number;
    duplicateFolderCount: number;
    mergingDuplicateFolders: boolean;
    onCreate: () => void;
    onCreateFolder: () => void;
    onRenameFolder: (folder: VaultFolder) => void;
    onDeleteFolder: (folder: VaultFolder) => void;
    onDeleteAllFolders: () => void;
    onMergeDuplicateFolders: () => void;
  } = $props();

  function closeMobile() {
    mobileOpen = false;
  }
</script>

<!-- Sheet owns focus trapping and keyboard dismissal for the mobile navigation. -->
<Sheet.Root bind:open={mobileOpen}>
  <Sheet.Content side="left" class="w-72 gap-0 p-0 md:hidden" showCloseButton={false}>
    <Sheet.Header class="sr-only">
      <Sheet.Title>{m.ui_vault_navigation()}</Sheet.Title>
      <Sheet.Description>{m.ui_filter_items_manage_folders_and_open_tools()}</Sheet.Description>
    </Sheet.Header>
    <VaultSidebar
      bind:activeCategory
      bind:activeFolder
      {duplicateCount}
      onCreate={() => {
        closeMobile();
        onCreate();
      }}
      {onCreateFolder}
      {onRenameFolder}
      {onDeleteFolder}
      {onDeleteAllFolders}
      {onMergeDuplicateFolders}
      {duplicateFolderCount}
      {mergingDuplicateFolders}
      onNavigate={closeMobile}
    />
  </Sheet.Content>
</Sheet.Root>

<div class="hidden md:flex">
  <VaultSidebar
    bind:activeCategory
    bind:activeFolder
    {duplicateCount}
    {onCreate}
    {onCreateFolder}
    {onRenameFolder}
    {onDeleteFolder}
    {onDeleteAllFolders}
    {onMergeDuplicateFolders}
    {duplicateFolderCount}
    {mergingDuplicateFolders}
  />
</div>
