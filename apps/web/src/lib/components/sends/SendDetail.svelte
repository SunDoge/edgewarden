<script lang="ts">
  import { formatDate, formatDateTime } from "$lib/i18n/format";
  import * as m from "$lib/paraglide/messages.js";

  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Check, Copy, ExternalLink, File as FileIcon, FileText, Trash2 } from "@lucide/svelte";
  import { match } from "ts-pattern";
  import type { DecryptedSend } from "$lib/services/send-crypto";

  let {
    send,
    copied = false,
    onCopy,
    onEdit,
    onDelete,
  }: {
    send: DecryptedSend;
    copied?: boolean;
    onCopy: () => void;
    onEdit: () => void;
    onDelete: () => void;
  } = $props();

  let sendType = $derived(
    match(send.type)
      .with(0, () => ({ label: m.ui_secure_text(), icon: FileText }))
      .with(1, () => ({ label: m.ui_secure_file(), icon: FileIcon }))
      .otherwise(() => ({ label: m.ui_secure_sharing(), icon: FileText })),
  );
  let TypeIcon = $derived(sendType.icon);

  function openShareLink() {
    window.open(
      `${window.location.origin}/sends/${send.accessId}#${send.shareKey}`,
      "_blank",
      "noopener,noreferrer",
    );
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center gap-3">
    <div
      class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
    >
      <TypeIcon />
    </div>
    <div class="min-w-0 flex-1">
      <h3 class="truncate text-lg font-bold">{send.name}</h3>
      <p class="text-xs text-muted-foreground">{sendType.label}</p>
    </div>
  </div>

  <Separator />

  <div class="flex flex-col gap-4">
    <Field.Field>
      <Field.Label for="send-share-link">{m.ui_sharing_link()}</Field.Label>
      <div class="flex items-center gap-2">
        <Input
          id="send-share-link"
          readonly
          value={`${window.location.origin}/sends/${send.accessId}#${send.shareKey}`}
          class="font-mono text-xs"
        />
        <Button
          variant="outline"
          size="icon"
          onclick={onCopy}
          class="shrink-0"
          aria-label={m.ui_copy_sharing_link()}
        >
          {#if copied}<Check class="text-primary" />{:else}<Copy />{/if}
        </Button>
      </div>
    </Field.Field>

    <div class="grid grid-cols-2 gap-4">
      <Card.Root
        ><Card.Header class="gap-1 p-3"
          ><Card.Description>{m.ui_access_count()}</Card.Description><Card.Title class="text-lg"
            >{send.accessCount}{#if send.maxAccessCount}
              / {send.maxAccessCount}{/if}{m.ui_accesses()}</Card.Title
          ></Card.Header
        ></Card.Root
      >
      <Card.Root
        ><Card.Header class="gap-1 p-3"
          ><Card.Description>{m.ui_deletion_date()}</Card.Description><Card.Title class="text-sm"
            >{formatDate(send.deletionDate)}</Card.Title
          ></Card.Header
        ></Card.Root
      >
    </div>

    <Card.Root>
      <Card.Header class="pb-3"
        ><Card.Title class="text-sm">{m.ui_security_settings()}</Card.Title></Card.Header
      >
      <Card.Content class="flex flex-col gap-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">{m.ui_password_protection()}</span><Badge
            variant={send.password ? "default" : "secondary"}
            >{send.password ? m.ui_enable() : m.ui_not_enabled()}</Badge
          >
        </div>
        <Separator />
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">{m.ui_link_status()}</span><Badge
            variant={send.disabled ? "destructive" : "secondary"}
            >{send.disabled ? m.ui_disabled() : m.ui_active()}</Badge
          >
        </div>
        <Separator />
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">{m.ui_sender_identity()}</span><Badge
            variant="outline">{send.hideEmail ? m.ui_hidden() : m.ui_public()}</Badge
          >
        </div>
      </Card.Content>
    </Card.Root>

    {#if send.type === 0 && send.text?.text}<Card.Root
        ><Card.Header class="pb-3"
          ><Card.Title class="text-sm">{m.ui_text_content()}</Card.Title></Card.Header
        ><Card.Content
          ><pre class="whitespace-pre-wrap break-words text-sm">{send.text.text}</pre></Card.Content
        ></Card.Root
      >{/if}
    {#if send.type === 1 && send.file}<Card.Root
        ><Card.Header class="pb-3"
          ><Card.Title class="text-sm">{m.ui_file()}</Card.Title></Card.Header
        ><Card.Content
          ><p class="text-sm font-medium">{send.file.fileName || m.ui_encrypted_file()}</p>
          <p class="text-xs text-muted-foreground">{send.file.sizeName || ""}</p></Card.Content
        ></Card.Root
      >{/if}
    {#if send.notes}<Card.Root
        ><Card.Header class="pb-3"
          ><Card.Title class="text-sm">{m.ui_notes()}</Card.Title></Card.Header
        ><Card.Content><p class="whitespace-pre-wrap text-sm">{send.notes}</p></Card.Content
        ></Card.Root
      >{/if}
    <div class="flex justify-between text-sm">
      <span class="text-muted-foreground">{m.ui_expiration_date()}</span><span
        >{send.expirationDate ? formatDateTime(send.expirationDate) : m.ui_never_expires()}</span
      >
    </div>
  </div>

  <div class="flex gap-2 pt-4">
    <Button
      variant="outline"
      size="icon"
      onclick={openShareLink}
      aria-label={m.ui_open_sharing_link()}><ExternalLink /></Button
    >
    <Button variant="outline" class="flex-1 font-semibold" onclick={onEdit}
      >{m.ui_edit_settings()}</Button
    >
    <Button
      variant="destructive"
      size="icon"
      class="shrink-0"
      onclick={onDelete}
      aria-label={m.ui_delete_send_2()}><Trash2 /></Button
    >
  </div>
</div>
