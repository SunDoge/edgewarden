<script lang="ts">
  import { ArrowLeft, Lock } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { fade } from "svelte/transition";
  import type { VaultEditorForm as VaultEditorDraft } from "$lib/services/vault-editor";
  import type {
    VaultAttachment,
    VaultCipher,
    VaultCollection,
    VaultFolder,
    VaultOrganization,
    VaultTotp,
  } from "$lib/services/vault-types";
  import VaultEditorForm from "./VaultEditorForm.svelte";
  import VaultItemDetail from "./VaultItemDetail.svelte";

  let {
    visible,
    isCreating,
    isEditing,
    editor = $bindable(),
    selectedItem,
    folders,
    organizations,
    collections,
    totp,
    attachmentBusy,
    isSyncing,
    onBack,
    onSave,
    onDelete,
    onCancel,
    onFavorite,
    onArchive,
    onRestore,
    onEdit,
    onAttachmentUpload,
    onAttachmentDownload,
    onAttachmentDelete,
  }: {
    visible: boolean;
    isCreating: boolean;
    isEditing: boolean;
    editor: VaultEditorDraft;
    selectedItem: VaultCipher | null;
    folders: VaultFolder[];
    organizations: VaultOrganization[];
    collections: VaultCollection[];
    totp: VaultTotp | null;
    attachmentBusy: string | null;
    isSyncing: boolean;
    onBack: () => void;
    onSave: () => void;
    onDelete: () => void;
    onCancel: () => void;
    onFavorite: () => void;
    onArchive: () => void;
    onRestore: () => void;
    onEdit: () => void;
    onAttachmentUpload: (event: Event) => void;
    onAttachmentDownload: (attachment: VaultAttachment) => void;
    onAttachmentDelete: (attachment: VaultAttachment) => void;
  } = $props();
</script>

<section
  class="{visible
    ? 'flex'
    : 'hidden'} absolute inset-0 z-10 w-full flex-col overflow-y-auto border-l bg-background p-4 md:static md:flex md:w-96 md:shrink-0 md:p-6"
>
  <div class="mb-4 md:hidden">
    <Button variant="ghost" size="sm" onclick={onBack}><ArrowLeft />返回列表</Button>
  </div>
  {#key isCreating ? "create" : isEditing ? `edit-${selectedItem?.id ?? "new"}` : (selectedItem?.id ?? (isSyncing ? "syncing" : "empty"))}
    <div class="min-h-0 flex-1" transition:fade={{ duration: 140 }}>
      {#if isCreating || isEditing}
        <VaultEditorForm
          bind:form={editor}
          {isCreating}
          {isEditing}
          {folders}
          {organizations}
          {collections}
          {onSave}
          {onDelete}
          {onCancel}
        />
      {:else if selectedItem}
        <VaultItemDetail
          item={selectedItem}
          {folders}
          {totp}
          {attachmentBusy}
          {onFavorite}
          {onArchive}
          {onRestore}
          {onEdit}
          {onDelete}
          {onAttachmentUpload}
          {onAttachmentDownload}
          {onAttachmentDelete}
        />
      {:else if isSyncing}
        <div class="flex flex-col gap-6" aria-label="正在加载项目详情">
          <div class="flex items-center gap-3">
            <Skeleton class="size-12 shrink-0 rounded-2xl" />
            <div class="flex flex-1 flex-col gap-2">
              <Skeleton class="h-5 w-1/2" /><Skeleton class="h-3 w-1/3" />
            </div>
          </div>
          <Separator />
          <div class="flex flex-col gap-4">
            {#each Array(3) as _}<div class="flex flex-col gap-2">
                <Skeleton class="h-3 w-1/4" /><Skeleton class="h-10 w-full" />
              </div>{/each}
          </div>
        </div>
      {:else}
        <Empty.Root class="h-full"
          ><Empty.Media variant="icon"><Lock /></Empty.Media><Empty.Header
            ><Empty.Title>选择一个项目查看详情</Empty.Title><Empty.Description
              >点击列表中任何条目，将在此显示解密数据。</Empty.Description
            ></Empty.Header
          ></Empty.Root
        >
      {/if}
    </div>
  {/key}
</section>
