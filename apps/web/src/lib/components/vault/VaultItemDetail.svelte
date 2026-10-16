<script lang="ts">
  import { formatDateTime } from "$lib/i18n/format";
  import * as m from "$lib/paraglide/messages.js";

  import { CipherType } from "@edgewarden/shared";
  import {
    Archive,
    ArchiveRestore,
    Check,
    Copy,
    CopyPlus,
    Download,
    Edit,
    Eye,
    EyeOff,
    Folder,
    Paperclip,
    RotateCcw,
    Share2,
    Star,
    Trash2,
    Upload,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import LoginCipherDetail from "./LoginCipherDetail.svelte";
  import CardCipherDetail from "./CardCipherDetail.svelte";
  import IdentityCipherDetail from "./IdentityCipherDetail.svelte";
  import {
    cipherDomain as getDomain,
    cipherExtraData as getExtraData,
    cipherTypeIcon as getItemIcon,
    cipherTypeName as getTypeName,
  } from "$lib/services/vault-item-display";
  import type {
    VaultAttachment,
    VaultCipher,
    VaultFolder,
    VaultTotp,
  } from "$lib/services/vault-types";

  let {
    item,
    folders,
    totp,
    attachmentBusy,
    cloneBusy,
    onFavorite,
    onArchive,
    onRestore,
    onEdit,
    onShare,
    onCloneToPersonal,
    canShare,
    onDelete,
    onAttachmentUpload,
    onAttachmentDownload,
    onAttachmentDelete,
  }: {
    item: VaultCipher;
    folders: VaultFolder[];
    totp: VaultTotp | null;
    attachmentBusy: string | null;
    cloneBusy: boolean;
    onFavorite: () => void;
    onArchive: () => void;
    onRestore: () => void;
    onEdit: () => void;
    onShare: () => void;
    onCloneToPersonal: () => void;
    canShare: boolean;
    onDelete: () => void;
    onAttachmentUpload: (event: Event) => void;
    onAttachmentDownload: (attachment: VaultAttachment) => void;
    onAttachmentDelete: (attachment: VaultAttachment) => void;
  } = $props();

  let copiedField = $state<string | null>(null);
  let hiddenFieldsMap = $state<Record<number, boolean>>({});
  let attachmentInput = $state<HTMLInputElement | null>(null);
  let IconComp = $derived(getItemIcon(item.type));

  $effect(() => {
    item.id;
    hiddenFieldsMap = {};
  });

  function copyToClipboard(text: string, fieldName: string) {
    navigator.clipboard.writeText(text);
    copiedField = fieldName;
    setTimeout(() => {
      if (copiedField === fieldName) copiedField = null;
    }, 2000);
  }
</script>

<div class="flex flex-col gap-6 animate-in fade-in duration-200">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3 min-w-0">
      <div
        class="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-muted text-muted-foreground"
      >
        {#if getDomain(item)}
          <img
            src="/icons/{encodeURIComponent(getDomain(item) ?? '')}/icon.png"
            alt=""
            class="size-6.5 object-contain rounded-md"
            onload={(e) => {
              (e.currentTarget as HTMLImageElement).style.opacity = "1";
            }}
            onerror={(e) => {
              const target = e.currentTarget as HTMLImageElement;
              target.style.display = "none";
              const fallback = target.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.classList.remove("invisible");
            }}
            style="opacity: 0; transition: opacity 0.2s;"
          />
          <div class="invisible absolute inset-0 flex items-center justify-center">
            <IconComp class="size-6" />
          </div>
        {:else}
          <IconComp class="size-6" />
        {/if}
      </div>
      <div class="min-w-0">
        <h3 class="flex items-center gap-1.5 truncate text-lg font-bold">
          {item.name}
          {#if item.favorite}
            <Star class="size-4 fill-current text-amber-400 shrink-0" />
          {/if}
        </h3>
        <p class="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{getTypeName(item.type)}</span>
          {#if item.folderId}
            {@const folder = folders.find((f) => f.id === item.folderId)}
            {#if folder}
              <span aria-hidden="true">•</span>
              <span class="flex items-center gap-0.5 max-w-[120px] truncate">
                <Folder class="size-3 shrink-0" />
                {folder.name}
              </span>
            {/if}
          {/if}
        </p>
      </div>
    </div>
    <div class="flex gap-1.5 shrink-0">
      {#if !item.deletedDate && !item.readOnly}<Button
          variant="ghost"
          size="icon"
          onclick={() => onFavorite()}
          class="size-8.5 rounded-lg"
          title={item.favorite ? m.ui_remove_from_favorites() : m.ui_add_to_favorites()}
          ><Star class="size-4 {item.favorite ? 'fill-current text-amber-400' : ''}" /></Button
        >{/if}
      {#if !item.deletedDate && !item.readOnly}<Button
          variant="ghost"
          size="icon"
          onclick={onArchive}
          class="size-8.5 rounded-lg"
          title={item.archivedDate ? m.ui_unarchive() : m.ui_archive()}
          >{#if item.archivedDate}<ArchiveRestore class="size-4" />{:else}<Archive
              class="size-4"
            />{/if}</Button
        >{/if}
      {#if item.deletedDate && !item.readOnly}
        <Button
          variant="ghost"
          size="icon"
          onclick={onRestore}
          class="size-8.5 rounded-lg"
          title={m.ui_restore()}><RotateCcw class="size-4" /></Button
        >
      {:else if !item.readOnly}
        {#if !item.organizationId && canShare}
          <Button
            variant="ghost"
            size="icon-sm"
            onclick={onShare}
            title={m.ui_share_with_organization()}><Share2 /></Button
          >
        {/if}
        <Button variant="ghost" size="icon-sm" onclick={onEdit} title={m.ui_edit()}><Edit /></Button
        >
      {/if}
      {#if !item.readOnly}<Button
          variant="ghost"
          size="icon-sm"
          onclick={onDelete}
          class="text-destructive hover:text-destructive"
          title={m.ui_delete()}
        >
          <Trash2 />
        </Button>{/if}
    </div>
  </div>

  <Separator />

  {#if item.organizationId && !item.hidePasswords}
    <Button variant="outline" class="w-full" onclick={onCloneToPersonal} disabled={cloneBusy}
      >{#if cloneBusy}<Spinner />{:else}<CopyPlus />{/if}{m.ui_save_to_personal_vault()}</Button
    >
  {/if}

  <!-- Login -->
  {#if item.type === CipherType.Login}
    {#key item.id}<LoginCipherDetail
        login={item.login}
        hidePasswords={item.hidePasswords}
        {totp}
      />{/key}
  {/if}

  {#if item.type === CipherType.Card}<CardCipherDetail
      card={item.card}
      {copiedField}
      onCopy={copyToClipboard}
    />{/if}
  {#if item.type === CipherType.Identity}<IdentityCipherDetail
      identity={item.identity}
      {copiedField}
      onCopy={copyToClipboard}
    />{/if}
  {#if getExtraData(item)}
    <div class="flex flex-col gap-3">
      {#each Object.entries(getExtraData(item) ?? {}) as [key, value]}
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-semibold text-muted-foreground">{key}</span>
          <div class="flex items-center justify-between rounded-lg border bg-background p-2">
            <span class="break-all text-sm font-mono">{String(value ?? "")}</span><Button
              variant="ghost"
              size="icon-sm"
              onclick={() => copyToClipboard(String(value ?? ""), `extra-${key}`)}
              aria-label={m.ui_copy_value_2({ value0: key })}><Copy /></Button
            >
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Notes -->
  {#if item.notes}
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-muted-foreground">{m.ui_notes_3()}</span>
      <div class="rounded-lg border bg-background p-3 text-sm whitespace-pre-wrap leading-relaxed">
        {item.notes}
      </div>
    </div>
  {/if}

  <!-- Custom Fields -->
  {#if item.fields && item.fields.length > 0}
    <div class="mt-4 flex flex-col gap-4 border-t pt-4">
      <h4 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {m.ui_custom_fields()}
      </h4>
      {#each item.fields as field, idx}
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-semibold text-muted-foreground"
            >{field.name || m.ui_untitled()}</span
          >

          {#if field.type === 2 || field.type === "2"}
            <div class="flex items-center gap-2 rounded-lg border bg-background p-2.5">
              <Checkbox checked={field.value === "true" || field.value === true} disabled />
              <span class="text-sm font-medium">
                {#if field.value === "true" || field.value === true}{m.ui_yes()}{:else}{m.ui_no()}{/if}
              </span>
            </div>
          {:else if field.type === 1 || field.type === "1"}
            <div class="flex items-center justify-between rounded-lg border bg-background p-2">
              <span class="text-sm font-mono truncate pr-2 select-all">
                {#if hiddenFieldsMap[idx]}{field.value}{:else}••••••••••••{/if}
              </span>
              <div class="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  onclick={() => (hiddenFieldsMap[idx] = !hiddenFieldsMap[idx])}
                >
                  {#if hiddenFieldsMap[idx]}
                    <EyeOff />
                  {:else}
                    <Eye />
                  {/if}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  onclick={() => copyToClipboard(String(field.value ?? ""), `field-${idx}`)}
                >
                  {#if copiedField === `field-${idx}`}<Check class="text-primary" />{:else}<Copy
                    />{/if}
                </Button>
              </div>
            </div>
          {:else}
            <div class="flex items-center justify-between rounded-lg border bg-background p-2">
              <span class="text-sm font-medium truncate pr-2 select-all">{field.value || ""}</span>
              <Button
                variant="ghost"
                size="icon"
                class="size-8"
                onclick={() => copyToClipboard(String(field.value ?? ""), `field-${idx}`)}
              >
                {#if copiedField === `field-${idx}`}<Check class="text-primary" />{:else}<Copy
                  />{/if}
              </Button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Attachments are encrypted in the browser before upload. -->
  {#if !item.deletedDate}
    <div class="border-t pt-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h4
          class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"
        >
          <Paperclip class="size-3.5" />{m.ui_attachments()}
        </h4>
        <input
          bind:this={attachmentInput}
          type="file"
          class="sr-only"
          onchange={onAttachmentUpload}
          aria-label={m.ui_choose_an_attachment_to_upload()}
        />
        {#if !item.readOnly}<Button
            type="button"
            size="xs"
            variant="outline"
            disabled={attachmentBusy !== null}
            onclick={() => attachmentInput?.click()}
          >
            <Upload />{attachmentBusy === "upload" ? m.ui_encrypting() : m.ui_add_attachment()}
          </Button>{/if}
      </div>
      {#if item.attachments?.length}
        <div class="flex flex-col gap-2">
          {#each item.attachments as attachment (attachment.id)}
            <div class="flex items-center gap-2 rounded-lg border bg-background p-2">
              <Paperclip class="size-4 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{attachment.fileName}</p>
                <p class="text-xs text-muted-foreground">{attachment.sizeName}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={attachmentBusy !== null}
                onclick={() => onAttachmentDownload(attachment)}
                aria-label={m.ui_download_value({ value0: attachment.fileName })}
                ><Download /></Button
              >
              {#if !item.readOnly}<Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={attachmentBusy !== null}
                  onclick={() => onAttachmentDelete(attachment)}
                  aria-label={m.ui_delete_value({ value0: attachment.fileName })}
                  class="text-red-500"><Trash2 /></Button
                >{/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-muted-foreground">
          {m.ui_no_attachments_file_contents_and_names_are_encrypted_in_your_browser()}
        </p>
      {/if}
    </div>
  {/if}

  <!-- Item History Meta -->
  <div
    class="mt-6 flex flex-col gap-1 rounded-lg border-t bg-muted/50 p-3 pt-4 text-xs text-muted-foreground"
  >
    {#if item.creationDate}
      <p class="flex justify-between">
        <span>{m.ui_created()}</span>
        <span>{formatDateTime(item.creationDate)}</span>
      </p>
    {/if}
    {#if item.revisionDate}
      <p class="flex justify-between">
        <span>{m.ui_modified()}</span>
        <span>{formatDateTime(item.revisionDate)}</span>
      </p>
    {/if}
  </div>
</div>
