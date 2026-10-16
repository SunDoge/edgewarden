<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { KeyRound } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import {
    disableYubikeysApi,
    getYubikeySettingsApi,
    saveYubicoConfigApi,
    saveYubikeysApi,
  } from "$lib/services/api-two-factor";
  import { deriveMasterKey, deriveMasterPasswordHash } from "$lib/services/crypto";
  import type { YubikeySettingsResult } from "$lib/services/two-factor-types";

  let {
    email,
    kdfIterations,
    isAdmin,
    onMessage,
    onError,
    onSessionRevoked,
  }: {
    email: string;
    kdfIterations: number;
    isAdmin: boolean;
    onMessage: (message: string) => void;
    onError: (error: unknown) => void;
    onSessionRevoked: (reason: string) => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let busy = $state("");
  let password = $state("");
  let otps = $state("");
  let nfc = $state(false);
  let settings = $state<YubikeySettingsResult | null>(null);
  let clientId = $state("");
  let secretKey = $state("");
  let disableConfirmOpen = $state(false);
  let userVerificationToken = $state("");

  function registeredKeys(value: YubikeySettingsResult): string[] {
    return [value.key1, value.key2, value.key3, value.key4, value.key5].filter(
      (key): key is string => Boolean(key),
    );
  }

  async function passwordHash(): Promise<string> {
    const key = await deriveMasterKey(password, email, kdfIterations);
    return deriveMasterPasswordHash(key, password);
  }

  async function loadSettings() {
    if (!password) return;
    busy = "load";
    try {
      const result = await getYubikeySettingsApi(await passwordHash());
      settings = result.yubiKey;
      userVerificationToken = result.userVerificationToken;
      nfc = Boolean(result.yubiKey.nfc);
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  async function save() {
    if (!userVerificationToken || !otps.trim()) return;
    busy = "save";
    try {
      const values = otps.split(/\s+/).filter(Boolean).slice(0, 5);
      await saveYubikeysApi({
        key1: values[0],
        key2: values[1],
        key3: values[2],
        key4: values[3],
        key5: values[4],
        nfc,
        userVerificationToken,
      });
      otps = "";
      onMessage(m.ui_yubikey_two_step_login_enabled());
      await onSessionRevoked("two-factor-updated");
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  async function disable() {
    if (!userVerificationToken) return;
    disableConfirmOpen = false;
    busy = "disable";
    try {
      await disableYubikeysApi(userVerificationToken);
      onMessage(m.ui_yubikey_two_step_login_disabled());
      await onSessionRevoked("two-factor-updated");
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  async function saveConfig() {
    if (!password || !clientId || !secretKey) return;
    busy = "config";
    try {
      await saveYubicoConfigApi({
        masterPasswordHash: await passwordHash(),
        clientId: clientId.trim(),
        secretKey: secretKey.trim(),
      });
      secretKey = "";
      await loadSettings();
      onMessage(m.ui_yubico_validation_credentials_encrypted_and_saved());
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }
</script>

<Card.Root>
  <Card.Header
    ><Card.Title>YubiKey OTP</Card.Title><Card.Description
      >{m.ui_use_a_yubico_otp_hardware_key_as_a_second_factor_otps_are_verified_with_yubico_b()}</Card.Description
    ></Card.Header
  >
  <Card.Content
    ><Button variant="outline" onclick={() => (open = true)}
      ><KeyRound data-icon="inline-start" />{m.ui_manage_yubikey()}</Button
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
      settings = null;
    }
  }}
>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto">
    <Dialog.Header
      ><Dialog.Title>YubiKey OTP</Dialog.Title><Dialog.Description
        >{m.ui_touch_each_key_once_and_enter_its_full_otp_on_a_separate_line_the_server_stores_()}</Dialog.Description
      ></Dialog.Header
    >
    <Field.Group>
      <Field.Field
        ><Field.Label for="yubikey-password">{m.ui_current_master_password()}</Field.Label><Input
          id="yubikey-password"
          type="password"
          bind:value={password}
          autocomplete="current-password"
        /></Field.Field
      >
      <Field.Field orientation="horizontal"
        ><Button variant="outline" onclick={loadSettings} disabled={!password || busy === "load"}
          >{m.ui_load_settings()}</Button
        ></Field.Field
      >
      {#if settings}<div class="flex flex-col gap-2 rounded-md border p-3 text-sm">
          <div class="flex items-center justify-between">
            <span>{m.ui_status()}</span><Badge variant={settings.enabled ? "default" : "secondary"}
              >{settings.enabled ? m.ui_enabled() : m.ui_not_enabled()}</Badge
            >
          </div>
          <div>
            {m.ui_registered_value({ value0: registeredKeys(settings).join("、") || m.ui_none() })}
          </div>
          <div>
            {m.ui_yubico_validation_value({
              value0: settings.configured ? m.ui_configured() : m.ui_not_configured(),
            })}
          </div>
        </div>{/if}
      <Field.Field
        ><Field.Label for="yubikey-otps">{m.ui_new_yubikey_otp()}</Field.Label><Textarea
          id="yubikey-otps"
          bind:value={otps}
          rows={3}
          autocomplete="off"
          spellcheck={false}
          placeholder={m.ui_one_otp_per_line_up_to_5_keys()}
        /></Field.Field
      >
      <Field.Field orientation="horizontal"
        ><Switch id="yubikey-nfc" bind:checked={nfc} /><Field.Label for="yubikey-nfc"
          >{m.ui_allow_nfc_prompts()}</Field.Label
        ></Field.Field
      >
      {#if isAdmin}<Field.FieldSet class="rounded-md border p-3"
          ><Field.FieldLegend
            >{m.ui_yubico_validation_credentials_administrator()}</Field.FieldLegend
          ><Field.FieldGroup
            ><Field.Field
              ><Field.Label for="yubico-client-id">Client ID</Field.Label><Input
                id="yubico-client-id"
                bind:value={clientId}
                inputmode="numeric"
              /></Field.Field
            ><Field.Field
              ><Field.Label for="yubico-secret">Secret Key</Field.Label><Input
                id="yubico-secret"
                type="password"
                bind:value={secretKey}
                autocomplete="new-password"
              /></Field.Field
            ><Button
              variant="outline"
              onclick={saveConfig}
              disabled={!password || !clientId || !secretKey || busy === "config"}
              >{m.ui_encrypt_and_save_credentials()}</Button
            ></Field.FieldGroup
          ></Field.FieldSet
        >{/if}
    </Field.Group>
    <Dialog.Footer
      ><Button
        variant="destructive"
        onclick={() => (disableConfirmOpen = true)}
        disabled={!settings?.enabled || busy === "disable"}>{m.ui_disable_yubikey()}</Button
      ><Button onclick={save} disabled={!userVerificationToken || !otps.trim() || busy === "save"}
        >{m.ui_verify_and_save()}</Button
      ></Dialog.Footer
    >
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={disableConfirmOpen}
  ><AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_disable_yubikey_two_step_login()}</AlertDialog.Title
      ><AlertDialog.Description
        >{m.ui_registered_yubikeys_will_no_longer_work_as_second_factors_your_current_master_pa()}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={disable}>{m.ui_confirm_disabling()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  ></AlertDialog.Root
>
