<script lang="ts">
  import {
    Archive,
    ArchiveRestore,
    ListFilter,
    Folder,
    Lock,
    RotateCcw,
    Search,
    Star,
    Trash2,
    TriangleAlert,
  } from "@lucide/svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { match } from "ts-pattern";
  import { fade, slide } from "svelte/transition";
  import { cn } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import type { DuplicateMode, VaultCategory, VaultSort } from "$lib/services/vault-filter";
  import type { VaultCipher } from "$lib/services/vault-types";
  import { cipherDomain, cipherTypeIcon, cipherTypeName } from "$lib/services/vault-item-display";

  let {
    items,
    isSyncing,
    error,
    activeCategory,
    duplicateGroupCount,
    searchQuery = $bindable(),
    duplicateMode = $bindable(),
    sortMode = $bindable(),
    selectedItem = $bindable(),
    selectedIds,
    selectedCount,
    onToggleSelection,
    onBulkAction,
    onClearSelection,
    onSelectRedundant,
    onMove,
    onSelectItem,
    onOpenFilters,
  }: {
    items: VaultCipher[];
    isSyncing: boolean;
    error: string | null;
    activeCategory: VaultCategory;
    duplicateGroupCount: number;
    searchQuery: string;
    duplicateMode: DuplicateMode;
    sortMode: VaultSort;
    selectedItem: VaultCipher | null;
    selectedIds: Record<string, boolean>;
    selectedCount: number;
    onToggleSelection: (id: string) => void;
    onBulkAction: (action: "restore" | "permanent" | "unarchive" | "delete" | "archive") => void;
    onClearSelection: () => void;
    onSelectRedundant: () => void;
    onMove: () => void;
    onSelectItem?: (item: VaultCipher) => void;
    onOpenFilters?: () => void;
  } = $props();

  const rowHeight = 72;
  const overscan = 5;
  let listContainer = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let currentBucket = $state(0);
  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  let endIndex = $derived(
    Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan),
  );
  let visibleItems = $derived(items.slice(startIndex, endIndex));
  let padTop = $derived(startIndex * rowHeight);
  let padBottom = $derived(Math.max(0, (items.length - endIndex) * rowHeight));

  $effect(() => {
    items;
    if (listContainer) listContainer.scrollTop = 0;
    scrollTop = 0;
    currentBucket = 0;
  });

  function revealIcon(event: Event) {
    (event.currentTarget as HTMLImageElement).style.opacity = "1";
  }

  function hideBrokenIcon(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    image.style.display = "none";
    image.nextElementSibling?.classList.remove("invisible");
  }

  function duplicateModeLabel(mode: DuplicateMode) {
    return match(mode)
      .with("exact", () => m.ui_exact_duplicates())
      .with("login-site", () => m.ui_website_username_and_password())
      .with("login-credentials", () => m.ui_username_and_password())
      .with("password", () => m.ui_reused_passwords())
      .exhaustive();
  }

  function sortModeLabel(mode: VaultSort) {
    return match(mode)
      .with("edited", () => m.ui_recently_modified())
      .with("created", () => m.ui_recently_created())
      .with("name", () => m.ui_name())
      .exhaustive();
  }
</script>

<section class="flex flex-1 flex-col overflow-hidden border-r bg-background">
  <div class="flex shrink-0 flex-col gap-3 border-b p-4">
    <div class="flex flex-wrap gap-2 sm:flex-nowrap">
      <Button
        variant="outline"
        size="icon"
        class="md:hidden"
        onclick={onOpenFilters}
        aria-label={m.ui_open_vault_filters()}><ListFilter data-icon /></Button
      >
      <div class="relative flex-1">
        <Search
          class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        /><Input
          type="search"
          placeholder={m.ui_search_your_vault()}
          class="pl-10"
          bind:value={searchQuery}
        />
      </div>
      {#if activeCategory === "duplicates"}
        <Select.Root type="single" bind:value={duplicateMode}>
          <Select.Trigger class="w-44" aria-label={m.ui_duplicate_detection()}
            >{duplicateModeLabel(duplicateMode)}</Select.Trigger
          >
          <Select.Content
            ><Select.Group
              ><Select.Item value="exact">{m.ui_exact_duplicates()}</Select.Item><Select.Item
                value="login-site">{m.ui_website_username_and_password()}</Select.Item
              ><Select.Item value="login-credentials">{m.ui_username_and_password()}</Select.Item
              ><Select.Item value="password">{m.ui_reused_passwords()}</Select.Item></Select.Group
            ></Select.Content
          >
        </Select.Root>
      {/if}
      <Select.Root type="single" bind:value={sortMode}>
        <Select.Trigger class="w-28" aria-label={m.ui_sort_by()}
          >{sortModeLabel(sortMode)}</Select.Trigger
        >
        <Select.Content
          ><Select.Group
            ><Select.Item value="edited">{m.ui_recently_modified()}</Select.Item><Select.Item
              value="created">{m.ui_recently_created()}</Select.Item
            ><Select.Item value="name">{m.ui_name()}</Select.Item></Select.Group
          ></Select.Content
        >
      </Select.Root>
    </div>
    {#if activeCategory === "duplicates" && duplicateGroupCount > 0}
      <div
        transition:slide={{ duration: 160 }}
        class="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        <span
          >{m.ui_groups_value_items_value_keep_at_least_one_item_in_each_group({
            value0: duplicateGroupCount,
            value1: items.length,
          })}</span
        >
        {#if duplicateMode === "exact"}
          <Button size="sm" variant="outline" onclick={onSelectRedundant}
            >{m.ui_select_all_but_the_newest_in_each_group()}</Button
          >
        {/if}
      </div>
    {/if}
    {#if selectedCount}
      <div transition:slide={{ duration: 160 }} class="flex flex-wrap items-center gap-2 text-sm">
        <span>{m.ui_selected_items_value({ value0: selectedCount })}</span>
        {#if activeCategory === "trash"}
          <Button size="sm" variant="outline" onclick={() => onBulkAction("restore")}
            ><RotateCcw data-icon="inline-start" />{m.ui_restore()}</Button
          ><Button size="sm" variant="destructive" onclick={() => onBulkAction("permanent")}
            ><Trash2 data-icon="inline-start" />{m.ui_delete_permanently()}</Button
          >
        {:else if activeCategory === "archive"}
          <Button size="sm" variant="outline" onclick={() => onBulkAction("unarchive")}
            ><ArchiveRestore data-icon="inline-start" />{m.ui_unarchive()}</Button
          ><Button size="sm" variant="destructive" onclick={() => onBulkAction("delete")}
            ><Trash2 data-icon="inline-start" />{m.ui_move_to_trash()}</Button
          >
        {:else}
          <Button size="sm" variant="outline" onclick={() => onBulkAction("archive")}
            ><Archive data-icon="inline-start" />{m.ui_archive()}</Button
          ><Button size="sm" variant="outline" onclick={onMove}
            ><Folder data-icon="inline-start" />{m.ui_move()}</Button
          ><Button size="sm" variant="destructive" onclick={() => onBulkAction("delete")}
            ><Trash2 data-icon="inline-start" />{m.ui_move_to_trash()}</Button
          >
        {/if}
        <Button size="sm" variant="ghost" onclick={onClearSelection}
          >{m.ui_clear_selection()}</Button
        >
      </div>
    {/if}
  </div>

  <div
    bind:this={listContainer}
    bind:clientHeight={viewportHeight}
    onscroll={(event) => {
      const top = event.currentTarget.scrollTop;
      const bucket = Math.floor(Math.max(0, top) / rowHeight);
      if (bucket !== currentBucket) {
        currentBucket = bucket;
        scrollTop = top;
      }
    }}
    class="flex-1 overflow-y-auto"
  >
    {#if isSyncing}
      <div class="divide-y" transition:fade={{ duration: 120 }}>
        {#each Array(6) as _}<div class="flex w-full items-center gap-3.5 p-4">
            <Skeleton class="size-10 shrink-0 rounded-xl" />
            <div class="flex min-w-0 flex-1 flex-col gap-2 py-1">
              <Skeleton class="h-3.5 w-1/3" /><Skeleton class="h-2.5 w-1/2" />
            </div>
          </div>{/each}
      </div>
    {:else if error}
      <div class="p-4" transition:fade={{ duration: 140 }}>
        <Alert.Root variant="destructive">
          <TriangleAlert />
          <Alert.Title>{m.vault_load_error_title()}</Alert.Title>
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
      </div>
    {:else if items.length === 0}
      <div transition:fade={{ duration: 140 }}>
        <Empty.Root
          ><Empty.Header
            ><Empty.Media variant="icon"><Lock /></Empty.Media><Empty.Title
              >{m.ui_no_matching_items()}</Empty.Title
            ><Empty.Description
              >{m.ui_change_your_search_or_filters_or_add_a_new_item()}</Empty.Description
            ></Empty.Header
          ></Empty.Root
        >
      </div>
    {:else}
      <div style="padding-top: {padTop}px; padding-bottom: {padBottom}px;" class="divide-y">
        {#each visibleItems as item (item.id)}
          {@const Icon = cipherTypeIcon(item.type)}
          <div class="flex items-center">
            <Checkbox
              checked={!!selectedIds[item.id]}
              onCheckedChange={() => onToggleSelection(item.id)}
              aria-label={m.ui_select_value({ value0: item.name })}
              class="ml-3"
            /><Button
              variant="ghost"
              class={cn(
                "h-auto w-full justify-start gap-3.5 rounded-none border-l-2 border-transparent p-4 text-left",
                selectedItem?.id === item.id && "border-primary bg-muted/60",
              )}
              onclick={() => {
                selectedItem = item;
                onSelectItem?.(item);
              }}
            >
              <div
                class="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted text-muted-foreground"
              >
                {#if cipherDomain(item)}<img
                    src="/icons/{encodeURIComponent(cipherDomain(item) ?? '')}/icon.png"
                    alt=""
                    class="size-5.5 rounded-md object-contain"
                    onload={revealIcon}
                    onerror={hideBrokenIcon}
                    style="opacity: 0; transition: opacity 0.2s;"
                  />
                  <div class="invisible absolute inset-0 flex items-center justify-center">
                    <Icon class="size-5" />
                  </div>{:else}<Icon class="size-5" />{/if}
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <h4 class="truncate text-sm font-semibold text-foreground">{item.name}</h4>
                  {#if item.favorite}<Star
                      class="size-3 shrink-0 fill-current text-amber-400"
                    />{/if}
                </div>
                <p class="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.login?.username || cipherTypeName(item.type)}
                </p>
              </div>
            </Button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>
