<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import type { FolderResponse } from "@edgewarden/shared";
  import {
    Archive,
    Combine,
    Copy,
    CreditCard,
    Edit,
    FileText,
    Folder,
    KeyRound,
    Lock,
    Plus,
    Star,
    Trash2,
    User,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import type { VaultCategory } from "$lib/services/vault-filter";
  import { vault } from "$lib/stores/vault.svelte";

  let {
    activeCategory = $bindable(),
    activeFolder = $bindable(),
    duplicateCount,
    onCreate,
    onCreateFolder,
    onRenameFolder,
    onDeleteFolder,
    onDeleteAllFolders,
    onMergeDuplicateFolders,
    duplicateFolderCount,
    mergingDuplicateFolders,
    onNavigate,
  }: {
    activeCategory: VaultCategory;
    activeFolder: string | null;
    duplicateCount: number;
    onCreate: () => void;
    onCreateFolder: () => void;
    onRenameFolder: (folder: FolderResponse) => void;
    onDeleteFolder: (folder: FolderResponse) => void;
    onDeleteAllFolders: () => void;
    onMergeDuplicateFolders: () => void;
    duplicateFolderCount: number;
    mergingDuplicateFolders: boolean;
    onNavigate?: () => void;
  } = $props();

  const filters = $derived([
    {
      id: "all" as const,
      label: m.ui_all_items(),
      icon: Lock,
      count: vault.ciphers.filter((item) => !item.deletedDate && !item.archivedDate).length,
    },
    {
      id: "favorites" as const,
      label: m.ui_favorites(),
      icon: Star,
      count: vault.ciphers.filter(
        (item) => item.favorite && !item.deletedDate && !item.archivedDate,
      ).length,
    },
    {
      id: "archive" as const,
      label: m.ui_archive(),
      icon: Archive,
      count: vault.ciphers.filter((item) => item.archivedDate && !item.deletedDate).length,
    },
    {
      id: "trash" as const,
      label: m.ui_trash(),
      icon: Trash2,
      count: vault.ciphers.filter((item) => item.deletedDate).length,
    },
    {
      id: "duplicates" as const,
      label: m.ui_duplicates(),
      icon: Copy,
      count: duplicateCount,
    },
  ]);

  const cipherTypes = $derived([
    { id: "login" as const, label: m.ui_login(), icon: KeyRound },
    { id: "card" as const, label: m.ui_card(), icon: CreditCard },
    { id: "identity" as const, label: m.ui_identity(), icon: User },
    { id: "securenote" as const, label: m.ui_secure_note(), icon: FileText },
  ]);

  function selectCategory(category: VaultCategory) {
    activeCategory = category;
    activeFolder = null;
    onNavigate?.();
  }
</script>

<aside class="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r bg-background p-4">
  <Button class="mb-6 w-full gap-2" onclick={onCreate}>
    <Plus data-icon="inline-start" />{m.ui_new_item()}</Button
  >

  <nav class="flex flex-col gap-1.5" aria-label={m.ui_vault_navigation()}>
    <p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {m.ui_filter_by_type()}
    </p>
    {#each filters as item (item.id)}
      <Button
        variant={activeCategory === item.id && !activeFolder ? "secondary" : "ghost"}
        class="w-full justify-start"
        onclick={() => selectCategory(item.id)}
      >
        <item.icon />
        <span>{item.label}</span>
        <Badge variant="secondary" class="ml-auto">{item.count}</Badge>
      </Button>
    {/each}

    <Separator class="my-2" />
    {#each cipherTypes as item (item.id)}
      <Button
        variant={activeCategory === item.id ? "secondary" : "ghost"}
        class="w-full justify-start"
        onclick={() => selectCategory(item.id)}
      >
        <item.icon />
        <span>{item.label}</span>
      </Button>
    {/each}
  </nav>

  <Separator class="my-4" />
  <nav class="flex flex-col gap-1" aria-labelledby="folders-heading">
    <div class="mb-2 flex items-center justify-between px-3">
      <p
        id="folders-heading"
        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {m.ui_folder()}
      </p>
      <div class="flex items-center gap-1">
        {#if duplicateFolderCount}
          <Button
            variant="ghost"
            size="icon-xs"
            onclick={onMergeDuplicateFolders}
            disabled={mergingDuplicateFolders}
            title={m.ui_merge_value_duplicate_folders_with_matching_names({
              value0: duplicateFolderCount,
            })}
            aria-label={m.ui_merge_folders_with_matching_names()}><Combine data-icon /></Button
          >
        {/if}
        {#if vault.folders.length}
          <Button
            variant="ghost"
            size="icon-xs"
            onclick={onDeleteAllFolders}
            title={m.ui_delete_all_folders()}
            aria-label={m.ui_delete_all_folders()}
            class="text-muted-foreground hover:text-destructive"><Trash2 data-icon /></Button
          >
        {/if}
        <Button
          variant="ghost"
          size="icon-xs"
          onclick={onCreateFolder}
          title={m.ui_new_folder()}
          aria-label={m.ui_new_folder()}
          class="text-muted-foreground"><Plus data-icon /></Button
        >
      </div>
    </div>
    {#each vault.folders as folder (folder.id)}
      <div
        class="group flex w-full items-center justify-between rounded-lg text-left text-sm font-medium transition-colors {activeFolder ===
        folder.id
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted'}"
      >
        <Button
          variant="ghost"
          class="h-auto min-w-0 flex-1 justify-start px-3 py-2"
          onclick={() => {
            activeFolder = folder.id;
            activeCategory = "all";
            onNavigate?.();
          }}
        >
          <Folder class="size-4 shrink-0" />
          <span class="truncate">{folder.name}</span>
        </Button>
        <div class="flex shrink-0 items-center gap-1.5 pr-2">
          <span
            class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground group-hover:hidden"
            >{vault.ciphers.filter((item) => item.folderId === folder.id).length}</span
          >
          <Button
            variant="ghost"
            size="icon-xs"
            class="hidden text-muted-foreground group-hover:inline-flex"
            onclick={(event) => {
              event.stopPropagation();
              onRenameFolder(folder);
            }}
            title={m.ui_rename()}
            aria-label={m.ui_rename_value({ value0: folder.name })}><Edit data-icon /></Button
          >
          <Button
            variant="ghost"
            size="icon-xs"
            class="hidden text-muted-foreground hover:text-destructive group-hover:inline-flex"
            onclick={(event) => {
              event.stopPropagation();
              onDeleteFolder(folder);
            }}
            title={m.ui_delete()}
            aria-label={m.ui_delete_value({ value0: folder.name })}><Trash2 data-icon /></Button
          >
        </div>
      </div>
    {:else}
      <p class="px-3 text-xs italic text-muted-foreground">{m.ui_no_folders_yet()}</p>
    {/each}
  </nav>
</aside>
