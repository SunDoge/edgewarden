<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { onMount } from "svelte";
  import { match } from "ts-pattern";
  import { goto } from "$app/navigation";
  import { fetchSendsApi, deleteSendApi, deleteSendsApi } from "$lib/services/api-sends";
  import { vault } from "$lib/stores/vault.svelte";
  import { decryptOwnedSend, type DecryptedSend } from "$lib/services/send-crypto";
  import { saveOwnedSend } from "$lib/services/send-actions";
  import { createSendEditorDraft, sendToEditorDraft } from "$lib/services/send-editor";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import SendEditorForm from "$lib/components/sends/SendEditorForm.svelte";
  import SendDetail from "$lib/components/sends/SendDetail.svelte";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { cn } from "$lib/utils";
  import {
    Search,
    Plus,
    LogOut,
    Star,
    ShieldCheck,
    RefreshCw,
    Trash2,
    ArrowLeft,
    Share2,
    FileText,
    File as FileIcon,
    Copy,
    Check,
  } from "@lucide/svelte";

  // State
  let sends = $state<DecryptedSend[]>([]);
  let loading = $state(true);
  let searchQuery = $state("");
  let typeFilter = $state<"all" | "text" | "file">("all");
  let selectedIds = $state<Record<string, boolean>>({});
  let selectedSend = $state<DecryptedSend | null>(null);
  let mobileDetailOpen = $state(false);

  // Form editor state
  let isCreating = $state(false);
  let isEditing = $state(false);
  let editor = $state(createSendEditorDraft());

  let copiedId = $state<string | null>(null);
  let errorMsg = $state("");
  let deleteTarget = $state<{ kind: "single"; id: string } | { kind: "bulk" } | null>(null);

  onMount(async () => {
    await loadSends();
  });

  async function loadSends() {
    loading = true;
    const cached = vault.sends;
    if (cached.length) sends = [...cached];
    if (vault.isOffline) {
      loading = false;
      return;
    }
    try {
      const res = await fetchSendsApi();
      const decryptedList = [];
      for (const send of res.data) {
        try {
          decryptedList.push(await decryptOwnedSend(send, vault.symEncKey!, vault.symMacKey!));
        } catch (e) {
          console.error("Failed to decrypt send:", send.id, e);
        }
      }
      sends = decryptedList;
    } catch (error) {
      if (!cached.length)
        errorMsg = m.ui_unable_to_load_sends_value({
          value0: error instanceof Error ? error.message : String(error),
        });
    } finally {
      loading = false;
    }
  }

  // Filtered Sends
  let filteredSends = $derived(
    sends.filter((item) => {
      const matchesType = match(typeFilter)
        .with("text", () => item.type === 0)
        .with("file", () => item.type === 1)
        .otherwise(() => true);
      if (!matchesType) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return item.name.toLowerCase().includes(q) || (item.notes ?? "").toLowerCase().includes(q);
      }
      return true;
    }),
  );
  let selectedIdList = $derived(Object.keys(selectedIds).filter((id) => selectedIds[id]));

  function startCreate() {
    isEditing = false;
    isCreating = true;
    mobileDetailOpen = true;
    editor = createSendEditorDraft();
  }

  function startEdit(send: DecryptedSend) {
    selectedSend = send;
    isEditing = true;
    isCreating = false;
    mobileDetailOpen = true;
    editor = sendToEditorDraft(send);
  }

  function cancelEdit() {
    isCreating = false;
    isEditing = false;
    if (!selectedSend) mobileDetailOpen = false;
  }

  function selectSend(send: DecryptedSend) {
    selectedSend = send;
    isCreating = false;
    isEditing = false;
    mobileDetailOpen = true;
  }

  async function handleSaveSend() {
    loading = true;
    try {
      await saveOwnedSend({
        form: editor,
        selectedSend,
        isCreating,
        isEditing,
        vaultKeys: { encKey: vault.symEncKey!, macKey: vault.symMacKey! },
      });

      isCreating = false;
      isEditing = false;
      selectedSend = null;
      await loadSends();
    } catch (error) {
      errorMsg = m.ui_unable_to_save_value({
        value0: error instanceof Error ? error.message : String(error),
      });
    } finally {
      loading = false;
    }
  }

  async function handleDeleteSend(sendId: string) {
    loading = true;
    try {
      await deleteSendApi(sendId);
      selectedSend = null;
      await loadSends();
    } catch (error) {
      errorMsg = m.ui_unable_to_delete_value({
        value0: error instanceof Error ? error.message : String(error),
      });
    } finally {
      loading = false;
    }
  }

  async function handleBulkDelete() {
    if (!selectedIdList.length) return;
    loading = true;
    try {
      await deleteSendsApi(selectedIdList);
      selectedIds = {};
      selectedSend = null;
      await loadSends();
    } catch (error) {
      errorMsg = m.ui_unable_to_delete_selected_items_value({
        value0: error instanceof Error ? error.message : String(error),
      });
    } finally {
      loading = false;
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteTarget = null;
    await match(target)
      .with({ kind: "single" }, ({ id }) => handleDeleteSend(id))
      .with({ kind: "bulk" }, () => handleBulkDelete())
      .exhaustive();
  }

  function copyShareLink(send: DecryptedSend) {
    const origin = window.location.origin;
    const link = `${origin}/sends/${send.accessId}#${send.shareKey}`;
    navigator.clipboard.writeText(link);
    copiedId = send.id;
    setTimeout(() => {
      if (copiedId === send.id) copiedId = null;
    }, 2000);
  }

  function copySelectedShareLink() {
    if (selectedSend) copyShareLink(selectedSend);
  }

  function editSelectedSend() {
    if (selectedSend) startEdit(selectedSend);
  }

  function requestSelectedSendDelete() {
    if (selectedSend) deleteTarget = { kind: "single", id: selectedSend.id };
  }
</script>

<svelte:head>
  <title>{m.ui_send_edgewarden()}</title>
</svelte:head>

<VaultPageShell
  title={m.nav_sends()}
  description={m.ui_create_and_manage_end_to_end_encrypted_temporary_shares()}
  width="full"
  fill
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="sm"
      onclick={loadSends}
      disabled={loading}
      aria-label={m.ui_refresh_sends()}
    >
      {#if loading}<Spinner />{:else}<RefreshCw data-icon />{/if}
    </Button>
  {/snippet}

  <div class="relative flex flex-1 overflow-hidden">
    <!-- Left Panel: Sends List -->
    <section
      class="{mobileDetailOpen
        ? 'hidden md:flex'
        : 'flex'} min-w-0 flex-1 flex-col overflow-hidden border-r border-border bg-background"
    >
      {#if errorMsg}<div class="p-3">
          <Alert.Root variant="destructive"
            ><Alert.Title>{m.ui_action_failed()}</Alert.Title><Alert.Description
              >{errorMsg}</Alert.Description
            ></Alert.Root
          >
        </div>{/if}
      <div class="flex shrink-0 items-center gap-2 border-b border-border p-3 sm:gap-3 sm:p-4">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={m.ui_search_your_sends()}
            class="pl-10"
            bind:value={searchQuery}
          />
        </div>
        <Button class="shrink-0 font-semibold" onclick={startCreate} aria-label={m.ui_new_send()}>
          <Plus data-icon="inline-start" />
          <span class="hidden sm:inline">{m.ui_new_send()}</span>
        </Button>
      </div>
      <div class="flex items-center gap-2 border-b px-4 py-2">
        <ToggleGroup.Root
          type="single"
          size="sm"
          value={typeFilter}
          onValueChange={(value) => {
            if (value) typeFilter = value as typeof typeFilter;
          }}
          >{#each [["all", m.ui_all()], ["text", m.ui_text()], ["file", m.ui_file()]] as option}<ToggleGroup.Item
              value={option[0]}>{option[1]}</ToggleGroup.Item
            >{/each}</ToggleGroup.Root
        >
        <span class="flex-1"></span>
        {#if selectedIdList.length}<Button
            size="sm"
            variant="destructive"
            onclick={() => (deleteTarget = { kind: "bulk" })}
            ><Trash2 data-icon="inline-start" />{m.ui_delete_value_items({
              value0: selectedIdList.length,
            })}</Button
          >{/if}
      </div>

      <div class="flex-1 divide-y overflow-y-auto">
        {#if loading && sends.length === 0}
          <Empty.Root
            ><Empty.Header
              ><Empty.Media><Spinner class="size-8" /></Empty.Media><Empty.Title
                >{m.ui_loading_sends()}</Empty.Title
              ><Empty.Description>{m.ui_decrypting_your_shared_content()}</Empty.Description
              ></Empty.Header
            ></Empty.Root
          >
        {:else if filteredSends.length === 0}
          <Empty.Root
            ><Empty.Header
              ><Empty.Media variant="icon"><Share2 /></Empty.Media><Empty.Title
                >{m.ui_no_sends_yet()}</Empty.Title
              ><Empty.Description
                >{m.ui_create_a_secure_link_to_share_encrypted_text_or_files()}</Empty.Description
              ></Empty.Header
            ><Empty.Content
              ><Button onclick={startCreate}
                ><Plus data-icon="inline-start" />{m.ui_new_send()}</Button
              ></Empty.Content
            ></Empty.Root
          >
        {:else}
          {#each filteredSends as send}
            <div
              role="button"
              tabindex="0"
              class={cn(
                "flex w-full items-center justify-between border-l-2 border-transparent p-4 text-left transition-colors hover:bg-muted/50",
                selectedSend?.id === send.id && "border-primary bg-muted/60",
              )}
              onclick={() => selectSend(send)}
              onkeydown={(event) => {
                if (event.key === "Enter" || event.key === " ") selectSend(send);
              }}
            >
              <div class="flex items-center gap-3.5 min-w-0 flex-1">
                <Checkbox
                  checked={Boolean(selectedIds[send.id])}
                  onclick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) =>
                    (selectedIds = { ...selectedIds, [send.id]: checked })}
                  aria-label={m.ui_select_value({ value0: send.name })}
                />
                <div
                  class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                >
                  {#if send.type === 0}
                    <FileText class="size-5" />
                  {:else}
                    <FileIcon class="size-5" />
                  {/if}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <h4 class="truncate text-sm font-semibold">{send.name}</h4>
                    {#if send.disabled}
                      <Badge variant="secondary">{m.ui_disabled()}</Badge>
                    {/if}
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted-foreground">
                    {m.ui_value_access_count_value({
                      value0: send.type === 0 ? m.ui_encrypted_text() : m.ui_encrypted_file(),
                      value1: send.accessCount,
                    })}
                  </p>
                </div>
              </div>

              <div class="ml-2 flex shrink-0 items-center gap-2 sm:ml-4">
                <Button
                  variant="outline"
                  size="sm"
                  class="size-8 gap-1.5 p-0 text-xs font-semibold sm:h-8 sm:w-auto sm:px-3"
                  onclick={(e) => {
                    e.stopPropagation();
                    copyShareLink(send);
                  }}
                  aria-label={copiedId === send.id
                    ? m.ui_link_copied()
                    : m.ui_copy_link_for_value({ value0: send.name })}
                >
                  {#if copiedId === send.id}
                    <Check data-icon="inline-start" />
                    <span class="hidden sm:inline">{m.ui_copied()}</span>
                  {:else}
                    <Copy data-icon="inline-start" />
                    <span class="hidden sm:inline">{m.ui_copy_link()}</span>
                  {/if}
                </Button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <!-- Right Panel: Send Details / Form Editor -->
    <section
      class="{mobileDetailOpen
        ? 'flex'
        : 'hidden'} absolute inset-0 z-10 w-full flex-col overflow-y-auto border-l bg-background p-4 md:static md:flex md:w-96 md:shrink-0 md:p-6"
    >
      <div class="mb-4 md:hidden">
        <Button
          variant="ghost"
          size="sm"
          onclick={() => {
            if (isCreating || isEditing) cancelEdit();
            else mobileDetailOpen = false;
          }}><ArrowLeft />{m.ui_back_to_list()}</Button
        >
      </div>
      {#if isCreating || isEditing}
        <SendEditorForm
          {isCreating}
          {isEditing}
          bind:form={editor}
          hasExistingPassword={Boolean(selectedSend?.password)}
          onSave={handleSaveSend}
          onCancel={cancelEdit}
        />
      {:else if selectedSend}
        <SendDetail
          send={selectedSend}
          copied={copiedId === selectedSend.id}
          onCopy={copySelectedShareLink}
          onEdit={editSelectedSend}
          onDelete={requestSelectedSendDelete}
        />
      {:else}
        <Empty.Root class="h-full"
          ><Empty.Header
            ><Empty.Media variant="icon"><Share2 /></Empty.Media><Empty.Title
              >{m.ui_select_a_send_to_view_details()}</Empty.Title
            ><Empty.Description
              >{m.ui_view_shared_content_access_counts_and_expiration_settings_here()}</Empty.Description
            ></Empty.Header
          ></Empty.Root
        >
      {/if}
    </section>
  </div>
</VaultPageShell>

<AlertDialog.Root
  open={deleteTarget !== null}
  onOpenChange={(open) => {
    if (!open) deleteTarget = null;
  }}
>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_delete_send()}</AlertDialog.Title><AlertDialog.Description
        >{m.ui_value_this_cannot_be_undone({
          value0:
            deleteTarget?.kind === "bulk"
              ? m.ui_permanently_delete_value_selected_sends({ value0: selectedIdList.length })
              : m.ui_this_send_will_be_permanently_deleted(),
        })}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={confirmDelete}>{m.ui_confirm_deletion()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>
