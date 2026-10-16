<script lang="ts">
  import { formatDateTime } from "$lib/i18n/format";
  import * as m from "$lib/paraglide/messages.js";

  import { ShieldCheck, Trash2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    createAccountPasskeyApi,
    deleteAccountPasskeyApi,
    getAccountPasskeyAssertionOptionsApi,
    getAccountPasskeyAttestationOptionsApi,
    listAccountPasskeysApi,
    updateAccountPasskeyEncryptionApi,
  } from "$lib/services/api-account";
  import { bytesToBase64, deriveMasterKey, deriveMasterPasswordHash } from "$lib/services/crypto";
  import {
    assertAccountPasskey,
    buildAccountPasskeyPrfKeySet,
    buildAccountPasskeyPrfKeySetFromPrfKey,
    createAccountPasskeyCredential,
  } from "$lib/services/passkeys";
  import { vault } from "$lib/stores/vault.svelte";
  import type { AccountPasskey } from "$lib/services/account-types";
  import type { PendingAccountPasskeyCredential } from "$lib/services/passkeys";

  let {
    email,
    kdfIterations,
    onMessage,
    onError,
  }: {
    email: string;
    kdfIterations: number;
    onMessage: (message: string) => void;
    onError: (error: unknown) => void;
  } = $props();

  let passkeys = $state<AccountPasskey[]>([]);
  let busy = $state("");
  let createOpen = $state(false);
  let name = $state("");
  let password = $state("");
  let deletePasskey = $state<AccountPasskey | null>(null);
  let deletePassword = $state("");
  let enablePasskey = $state<AccountPasskey | null>(null);
  let enablePassword = $state("");
  let pendingLoginOnly = $state<PendingAccountPasskeyCredential | null>(null);

  onMount(load);

  async function load() {
    try {
      passkeys = (await listAccountPasskeysApi()).data;
    } catch (error) {
      onError(error);
    }
  }

  async function passwordHash(value: string): Promise<string> {
    const key = await deriveMasterKey(value, email, kdfIterations);
    return deriveMasterPasswordHash(key, value);
  }

  async function createPasskey() {
    if (!password) return;
    busy = "create";
    try {
      const options = await getAccountPasskeyAttestationOptionsApi(await passwordHash(password));
      const pending = await createAccountPasskeyCredential(options);
      let keySet: {
        encryptedUserKey?: string;
        encryptedPublicKey?: string;
        encryptedPrivateKey?: string;
      } = {};
      if (pending.supportsPrf && vault.symEncKey && vault.symMacKey) {
        try {
          keySet = await buildAccountPasskeyPrfKeySet(pending, {
            symEncKey: bytesToBase64(vault.symEncKey),
            symMacKey: bytesToBase64(vault.symMacKey),
          });
        } catch (error) {
          pendingLoginOnly = pending;
          return;
        }
      }
      await persistPasskey(pending, keySet);
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  async function persistPasskey(
    pending: PendingAccountPasskeyCredential,
    keySet: Record<string, string | undefined> = {},
  ) {
    await createAccountPasskeyApi({
      token: pending.token,
      deviceResponse: pending.request,
      name: name.trim() || undefined,
      supportsPrf: pending.supportsPrf && !!keySet.encryptedUserKey,
      ...keySet,
    });
    await load();
    createOpen = false;
    pendingLoginOnly = null;
    name = "";
    password = "";
    onMessage(m.ui_passkey_added());
  }

  async function confirmLoginOnlyPasskey() {
    if (!pendingLoginOnly) return;
    busy = "create";
    try {
      await persistPasskey(pendingLoginOnly);
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  async function removePasskey() {
    if (!deletePasskey || !deletePassword) return;
    busy = "delete";
    try {
      await deleteAccountPasskeyApi(deletePasskey.id, await passwordHash(deletePassword));
      passkeys = passkeys.filter((item) => item.id !== deletePasskey?.id);
      deletePasskey = null;
      deletePassword = "";
      onMessage(m.ui_passkey_deleted());
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  async function enableDirectUnlock() {
    if (!enablePasskey || !enablePassword || !vault.symEncKey || !vault.symMacKey) return;
    busy = "enable";
    try {
      const assertion = await assertAccountPasskey(
        await getAccountPasskeyAssertionOptionsApi(
          await passwordHash(enablePassword),
          enablePasskey.id,
        ),
      );
      if (!assertion.prfKey)
        throw new Error(
          m.ui_this_passkey_did_not_return_a_prf_key_vault_unlock_cannot_be_enabled(),
        );
      const keySet = await buildAccountPasskeyPrfKeySetFromPrfKey(assertion.prfKey, {
        symEncKey: bytesToBase64(vault.symEncKey),
        symMacKey: bytesToBase64(vault.symMacKey),
      });
      await updateAccountPasskeyEncryptionApi({
        token: assertion.token,
        deviceResponse: assertion.deviceResponse,
        ...keySet,
      });
      await load();
      enablePasskey = null;
      enablePassword = "";
      onMessage(m.ui_passkey_vault_unlock_enabled());
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }
</script>

<Card.Root>
  <Card.Header class="flex-row items-start justify-between"
    ><div>
      <Card.Title>{m.ui_passkeys()}</Card.Title><Card.Description
        >{m.ui_add_up_to_5_webauthn_passkeys_devices_supporting_prf_can_also_unlock_your_vault()}</Card.Description
      >
    </div>
    <Button size="sm" onclick={() => (createOpen = true)} disabled={passkeys.length >= 5}
      >{m.ui_add()}</Button
    ></Card.Header
  >
  <Card.Content class="flex flex-col gap-2">
    {#each passkeys as passkey (passkey.id)}
      <div class="flex items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <div class="font-medium">{passkey.name || m.ui_passkeys()}</div>
          <div class="text-xs text-muted-foreground">
            {passkey.creationDate ? formatDateTime(passkey.creationDate) : ""}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Badge variant={passkey.prfStatus === 0 ? "default" : "secondary"}
            >{passkey.prfStatus === 0
              ? m.ui_can_unlock_vault()
              : passkey.prfStatus === 1
                ? m.ui_vault_unlock_available()
                : m.ui_login_only()}</Badge
          >{#if passkey.prfStatus === 1}<Button
              variant="outline"
              size="sm"
              onclick={() => (enablePasskey = passkey)}
              ><ShieldCheck data-icon="inline-start" />{m.ui_enable_vault_unlock()}</Button
            >{/if}<Button
            variant="ghost"
            size="icon-sm"
            onclick={() => (deletePasskey = passkey)}
            aria-label={m.ui_delete_passkey()}><Trash2 data-icon /></Button
          >
        </div>
      </div>
    {:else}<p class="py-4 text-sm text-muted-foreground">{m.ui_no_passkeys_added_yet()}</p>{/each}
  </Card.Content>
</Card.Root>

<Dialog.Root bind:open={createOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_add_passkey()}</Dialog.Title><Dialog.Description
        >{m.ui_verify_your_current_master_password_your_browser_will_then_prompt_for_a_passkey()}</Dialog.Description
      ></Dialog.Header
    ><Field.Group
      ><Field.Field
        ><Field.Label for="passkey-name">{m.ui_name()}</Field.Label><Input
          id="passkey-name"
          bind:value={name}
          placeholder={m.ui_for_example_macbook_touch_id()}
        /></Field.Field
      ><Field.Field
        ><Field.Label for="passkey-password">{m.ui_current_master_password()}</Field.Label><Input
          id="passkey-password"
          type="password"
          bind:value={password}
          autocomplete="current-password"
        /></Field.Field
      ></Field.Group
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (createOpen = false)}>{m.login_cancel()}</Button
      ><Button onclick={createPasskey} disabled={!password || busy === "create"}
        >{m.ui_create_passkey()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root
  open={!!enablePasskey}
  onOpenChange={(open) => {
    if (!open) enablePasskey = null;
  }}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_enable_vault_unlock()}</Dialog.Title><Dialog.Description
        >{m.ui_after_verifying_your_master_password_and_passkey_your_browser_will_use_prf_outpu()}</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="enable-passkey-password">{m.ui_current_master_password()}</Field.Label
      ><Input
        id="enable-passkey-password"
        type="password"
        bind:value={enablePassword}
        autocomplete="current-password"
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (enablePasskey = null)}>{m.login_cancel()}</Button
      ><Button onclick={enableDirectUnlock} disabled={!enablePassword || busy === "enable"}
        >{m.ui_enable()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root
  open={!!deletePasskey}
  onOpenChange={(open) => {
    if (!open) deletePasskey = null;
  }}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_delete_passkey()}</Dialog.Title><Dialog.Description
        >{m.ui_enter_your_current_master_password_to_delete_value({
          value0: deletePasskey?.name || m.ui_passkeys(),
        })}</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="delete-passkey-password">{m.ui_current_master_password()}</Field.Label
      ><Input
        id="delete-passkey-password"
        type="password"
        bind:value={deletePassword}
        autocomplete="current-password"
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (deletePasskey = null)}>{m.login_cancel()}</Button
      ><Button
        variant="destructive"
        onclick={removePasskey}
        disabled={!deletePassword || busy === "delete"}>{m.ui_delete()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<AlertDialog.Root
  open={pendingLoginOnly !== null}
  onOpenChange={(open) => {
    if (!open) pendingLoginOnly = null;
  }}
  ><AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_vault_unlock_unavailable()}</AlertDialog.Title
      ><AlertDialog.Description
        >{m.ui_this_passkey_did_not_provide_the_prf_output_needed_to_protect_your_vault_key_you()}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        onclick={confirmLoginOnlyPasskey}>{m.ui_save_for_login_only()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  ></AlertDialog.Root
>
