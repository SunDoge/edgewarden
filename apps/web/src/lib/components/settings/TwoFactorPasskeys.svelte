<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Fingerprint, Trash2 } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    createTwoFactorPasskeyApi,
    deleteAllTwoFactorPasskeysApi,
    deleteTwoFactorPasskeyApi,
    getTwoFactorPasskeyChallengeApi,
    getTwoFactorPasskeysApi,
  } from "$lib/services/api-two-factor";
  import { deriveMasterKey, deriveMasterPasswordHash } from "$lib/services/crypto";
  import { createTwoFactorPasskeyCredential } from "$lib/services/passkeys";
  import type { TwoFactorPasskey } from "$lib/services/two-factor-types";

  let {
    email,
    kdfIterations,
    onMessage,
    onError,
    onSessionRevoked,
  }: {
    email: string;
    kdfIterations: number;
    onMessage: (message: string) => void;
    onError: (error: unknown) => void;
    onSessionRevoked: (reason: string) => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let busy = $state("");
  let password = $state("");
  let name = $state("");
  let credentials = $state<TwoFactorPasskey[]>([]);
  let deleteId = $state<string | null>(null);
  let userVerificationToken = $state("");

  async function passwordHash(): Promise<string> {
    const key = await deriveMasterKey(password, email, kdfIterations);
    return deriveMasterPasswordHash(key, password);
  }

  async function load() {
    if (!password) return;
    busy = "load";
    try {
      const result = await getTwoFactorPasskeysApi(await passwordHash());
      credentials = result.webAuthn.keys ?? [];
      userVerificationToken = result.userVerificationToken;
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  async function add() {
    if (!userVerificationToken) return;
    busy = "create";
    try {
      const credential = await createTwoFactorPasskeyCredential(
        await getTwoFactorPasskeyChallengeApi(userVerificationToken),
      );
      const usedIds = new Set(credentials.map((item) => item.id));
      const id = Array.from({ length: 5 }, (_, index) => index).find(
        (candidate) => !usedIds.has(candidate),
      );
      if (id === undefined)
        throw new Error(m.ui_you_can_add_up_to_5_two_step_login_security_keys());
      await createTwoFactorPasskeyApi({
        id,
        userVerificationToken,
        name: name.trim() || m.ui_security_key(),
        ...credential,
      });
      name = "";
      onMessage(m.ui_two_step_login_security_key_added());
      await onSessionRevoked("two-factor-updated");
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  async function remove(id: number) {
    if (!userVerificationToken) return;
    deleteId = null;
    busy = `delete-${id}`;
    try {
      if (credentials.length === 1) {
        await deleteAllTwoFactorPasskeysApi(userVerificationToken);
      } else {
        await deleteTwoFactorPasskeyApi({ id, userVerificationToken });
      }
      onMessage(m.ui_two_step_login_security_key_deleted());
      await onSessionRevoked("two-factor-updated");
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }
</script>

<Card.Root>
  <Card.Header
    ><Card.Title>{m.ui_two_step_login_security_keys()}</Card.Title><Card.Description
      >{m.ui_these_credentials_are_second_factors_only_they_cannot_log_in_or_unlock_your_vaul()}</Card.Description
    ></Card.Header
  >
  <Card.Content
    ><Button variant="outline" onclick={() => (open = true)}
      ><Fingerprint data-icon="inline-start" />{m.ui_manage_security_keys()}</Button
    ></Card.Content
  >
</Card.Root>

<Dialog.Root
  {open}
  onOpenChange={(value) => {
    open = value;
    if (!value) {
      password = "";
      userVerificationToken = "";
      credentials = [];
    }
  }}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_two_step_login_security_keys()}</Dialog.Title><Dialog.Description
        >{m.ui_verify_your_master_password_before_adding_or_deleting_security_keys()}</Dialog.Description
      ></Dialog.Header
    ><Field.Group
      ><Field.Field
        ><Field.Label for="two-factor-passkey-password"
          >{m.ui_current_master_password()}</Field.Label
        ><Input
          id="two-factor-passkey-password"
          type="password"
          bind:value={password}
          autocomplete="current-password"
        /></Field.Field
      ><Field.Field orientation="horizontal"
        ><Button variant="outline" onclick={load} disabled={!password || busy === "load"}
          >{m.ui_load_settings()}</Button
        ></Field.Field
      >{#if credentials.length}<div class="flex flex-col gap-2">
          {#each credentials as credential (credential.id)}<div
              class="flex items-center justify-between rounded-md border p-3"
            >
              <span>{credential.name || m.ui_security_key()}</span><Button
                variant="ghost"
                size="icon-sm"
                onclick={() => (deleteId = String(credential.id))}
                disabled={busy === `delete-${credential.id}`}
                aria-label={m.ui_delete_security_key()}><Trash2 data-icon /></Button
              >
            </div>{/each}
        </div>{/if}<Field.Field
        ><Field.Label for="two-factor-passkey-name">{m.ui_new_security_key_name()}</Field.Label
        ><Input
          id="two-factor-passkey-name"
          bind:value={name}
          placeholder={m.ui_for_example_usb_security_key()}
        /></Field.Field
      ></Field.Group
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (open = false)}>{m.ui_close()}</Button><Button
        onclick={add}
        disabled={!userVerificationToken || busy === "create"}
        ><Fingerprint data-icon="inline-start" />{m.ui_add_security_key()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<AlertDialog.Root
  open={deleteId !== null}
  onOpenChange={(value) => {
    if (!value) deleteId = null;
  }}
  ><AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_delete_security_key()}</AlertDialog.Title><AlertDialog.Description
        >{m.ui_this_security_key_will_no_longer_work_for_two_step_login_after_deletion()}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={() => deleteId && remove(Number(deleteId))}
        >{m.ui_confirm_deletion()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  ></AlertDialog.Root
>
