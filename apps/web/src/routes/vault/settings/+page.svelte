<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    deleteAccountApi,
    disableTwoFactorApi,
    enableAuthenticatorApi,
    changeMasterPasswordApi,
    fetchApiKeyApi,
    fetchDevicesApi,
    fetchProfileApi,
    fetchRecoveryCodeApi,
    fetchTwoFactorApi,
    getAuthenticatorApi,
    rotateApiKeyApi,
    updateProfileApi,
  } from "$lib/services/api-account";
  import { deriveMasterKey, deriveMasterPasswordHash } from "$lib/services/crypto";
  import { vault, syncVaultData, logout } from "$lib/stores/vault.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import AccountSecurityDialogs from "$lib/components/settings/AccountSecurityDialogs.svelte";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import DeviceManager from "$lib/components/settings/DeviceManager.svelte";
  import SettingsGeneralPanel from "$lib/components/settings/SettingsGeneralPanel.svelte";
  import SettingsSecurityPanel from "$lib/components/settings/SettingsSecurityPanel.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import {
    applyThemePreference,
    loadClientPreferences,
    saveClientPreferences,
    type SessionTimeoutAction,
    type ThemePreference,
  } from "$lib/services/client-preferences";
  import { ArrowLeft, LoaderCircle } from "@lucide/svelte";
  import type { AccountDevice, AccountProfile } from "$lib/services/account-types";
  import { summarizeTwoFactorProviders } from "$lib/services/two-factor-status";

  let loading = $state(true);
  let busy = $state("");
  let message = $state("");
  let error = $state("");
  let profile = $state<AccountProfile | null>(null);
  let totpEnabled = $state(false);
  let otherTwoFactorEnabled = $state(false);
  let devices = $state<AccountDevice[]>([]);
  let apiKey = $state("");
  let name = $state("");
  let hint = $state("");
  let deleteAccountOpen = $state(false);
  let deleteAccountPassword = $state("");
  let totpOpen = $state(false);
  let totpKey = $state("");
  let totpToken = $state("");
  let totpVerificationToken = $state("");
  let verificationOpen = $state(false);
  let verificationPassword = $state("");
  let verificationAction = $state<"totp" | "recovery" | "api-key-reveal" | "api-key-rotate">(
    "totp",
  );
  let disableOpen = $state(false);
  let masterPassword = $state("");
  let recoveryCode = $state("");
  let recoveryOpen = $state(false);
  let recoveryConfirmed = $state(false);
  let passwordOpen = $state(false);
  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let theme = $state<ThemePreference>("system");
  let lockTimeoutMinutes = $state<"0" | "1" | "5" | "15" | "30">("15");
  let sessionTimeoutAction = $state<SessionTimeoutAction>("lock");
  let rotateApiKeyOpen = $state(false);

  function fail(value: unknown) {
    error = value instanceof Error ? value.message : m.ui_action_failed();
    message = "";
  }

  async function load() {
    loading = true;
    error = "";
    try {
      const [nextProfile, deviceResult, twoFactorResult] = await Promise.all([
        fetchProfileApi(),
        fetchDevicesApi(),
        fetchTwoFactorApi(),
      ]);
      profile = nextProfile;
      devices = deviceResult.data;
      const twoFactorStatus = summarizeTwoFactorProviders(twoFactorResult.data);
      totpEnabled = twoFactorStatus.totpEnabled;
      otherTwoFactorEnabled = twoFactorStatus.otherEnabled;
      name = profile.name ?? "";
      hint = profile.masterPasswordHint ?? "";
    } catch (e) {
      fail(e);
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    const preferences = loadClientPreferences();
    theme = preferences.theme;
    lockTimeoutMinutes = String(preferences.lockTimeoutMinutes) as typeof lockTimeoutMinutes;
    sessionTimeoutAction = preferences.sessionTimeoutAction;
    await load();
  });

  function saveLocalPreferences() {
    saveClientPreferences({
      theme,
      lockTimeoutMinutes: Number(lockTimeoutMinutes) as 0 | 1 | 5 | 15 | 30,
      sessionTimeoutAction,
    });
    applyThemePreference(theme);
    message = m.ui_appearance_and_session_settings_saved();
  }

  async function saveProfile() {
    busy = "profile";
    error = "";
    try {
      profile = await updateProfileApi({
        name: name.trim() || null,
        masterPasswordHint: hint.trim() || null,
      });
      await syncVaultData();
      message = m.ui_profile_saved();
    } catch (e) {
      fail(e);
    } finally {
      busy = "";
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    message = m.ui_copied_to_clipboard();
  }

  async function removeAccount() {
    if (!deleteAccountPassword) return;
    busy = "delete-account";
    try {
      await deleteAccountApi(await passwordHash(deleteAccountPassword));
      deleteAccountPassword = "";
      await logout();
      await goto("/login?reason=account-deleted");
    } catch (e) {
      fail(e);
    } finally {
      busy = "";
    }
  }

  function requestSensitiveAction(
    action: "totp" | "recovery" | "api-key-reveal" | "api-key-rotate",
  ) {
    verificationAction = action;
    verificationPassword = "";
    verificationOpen = true;
  }

  function resetTotpSetup() {
    totpKey = "";
    totpToken = "";
    totpVerificationToken = "";
  }

  async function verifySensitiveAction() {
    if (!verificationPassword) return;
    busy = "verification";
    try {
      const hash = await passwordHash(verificationPassword);
      if (verificationAction === "totp") {
        const result = await getAuthenticatorApi(hash);
        totpKey = result.authenticator.key;
        totpVerificationToken = result.userVerificationToken;
        totpToken = "";
        totpOpen = true;
      } else if (verificationAction === "recovery") {
        recoveryCode = (await fetchRecoveryCodeApi(hash)).code ?? "";
      } else if (verificationAction === "api-key-reveal") {
        apiKey = (await fetchApiKeyApi(hash)).apiKey;
      } else {
        apiKey = (await rotateApiKeyApi(hash)).apiKey;
        message = m.ui_api_key_rotated();
      }
      verificationOpen = false;
      verificationPassword = "";
    } catch (e) {
      fail(e);
    } finally {
      busy = "";
    }
  }

  async function enableTotp() {
    if (!profile) return;
    busy = "totp-enable";
    try {
      const result = await enableAuthenticatorApi(
        totpKey,
        totpToken.replace(/\s/g, ""),
        totpVerificationToken,
      );
      profile.twoFactorEnabled = true;
      totpEnabled = true;
      totpOpen = false;
      recoveryCode = result.recoveryCode;
      recoveryConfirmed = false;
      recoveryOpen = true;
      totpVerificationToken = "";
      message = m.ui_authenticator_enabled_save_your_recovery_code_now();
    } catch (e) {
      fail(e);
    } finally {
      busy = "";
    }
  }

  async function finishRecoverySetup() {
    recoveryOpen = false;
    await logout();
    await goto("/login?reason=two-factor-enabled");
  }

  async function disableTotp() {
    if (!profile || !masterPassword) return;
    busy = "totp-disable";
    try {
      const key = await deriveMasterKey(masterPassword, profile.email, profile.kdfIterations);
      const hash = await deriveMasterPasswordHash(key, masterPassword);
      await disableTwoFactorApi(hash);
      totpEnabled = false;
      otherTwoFactorEnabled = false;
      profile.twoFactorEnabled = false;
      disableOpen = false;
      masterPassword = "";
      recoveryCode = "";
      await logout();
      await goto("/login?reason=two-factor-disabled");
    } catch (e) {
      fail(e);
    } finally {
      busy = "";
    }
  }

  async function passwordHash(password: string): Promise<string> {
    if (!profile) throw new Error(m.ui_account_details_have_not_loaded_yet());
    const key = await deriveMasterKey(password, profile.email, profile.kdfIterations);
    return deriveMasterPasswordHash(key, password);
  }

  async function changeMasterPassword() {
    if (!profile) return fail(new Error(m.ui_account_details_have_not_loaded_yet()));
    if (newPassword.length < 12)
      return fail(new Error(m.ui_your_new_master_password_must_contain_at_least_12_characters()));
    if (newPassword !== confirmPassword)
      return fail(new Error(m.ui_the_new_passwords_do_not_match()));
    busy = "password";
    try {
      await changeMasterPasswordApi({
        email: profile.email,
        currentPassword,
        newPassword,
        iterations: profile.kdfIterations,
        profileKey: profile.key,
        masterPasswordHint: hint.trim() || null,
      });
      passwordOpen = false;
      await logout();
      await goto("/login?passwordChanged=1");
    } catch (e) {
      fail(e);
    } finally {
      busy = "";
    }
  }
</script>

<svelte:head><title>{m.ui_account_and_security_edgewarden()}</title></svelte:head>

<VaultPageShell
  title={m.nav_settings()}
  description={m.ui_manage_your_profile_api_key_two_step_login_and_devices()}
  width="default"
>
  {#if error}<Alert.Root variant="destructive"
      ><Alert.Title>{m.ui_action_failed()}</Alert.Title><Alert.Description
        >{error}</Alert.Description
      ></Alert.Root
    >{/if}
  {#if message}<Alert.Root
      ><Alert.Title>{m.ui_settings_updated()}</Alert.Title><Alert.Description
        >{message}</Alert.Description
      ></Alert.Root
    >{/if}

  {#if loading}
    <div class="flex items-center gap-2 py-12 text-muted-foreground">
      <LoaderCircle class="animate-spin" />{m.ui_loading_account_settings()}
    </div>
  {:else if profile}
    <Tabs.Root
      value={page.url.searchParams.get("tab") === "security" ? "security" : "general"}
      class="flex flex-col gap-6"
    >
      <Tabs.List class="grid h-auto w-full grid-cols-2 sm:grid-cols-4"
        ><Tabs.Trigger value="general">{m.ui_general()}</Tabs.Trigger><Tabs.Trigger value="security"
          >{m.ui_security()}</Tabs.Trigger
        ><Tabs.Trigger value="devices">{m.ui_devices()}</Tabs.Trigger><Tabs.Trigger value="danger"
          >{m.ui_danger_zone()}</Tabs.Trigger
        ></Tabs.List
      >
      <Tabs.Content value="general"
        ><SettingsGeneralPanel
          email={profile.email}
          bind:theme
          bind:lockTimeoutMinutes
          bind:sessionTimeoutAction
          bind:name
          bind:hint
          {apiKey}
          {busy}
          onSavePreferences={saveLocalPreferences}
          onSaveProfile={saveProfile}
          onCopy={copy}
          onRevealApiKey={() => requestSensitiveAction("api-key-reveal")}
          onRotateApiKey={() => (rotateApiKeyOpen = true)}
        /></Tabs.Content
      >
      <Tabs.Content value="security"
        ><SettingsSecurityPanel
          {profile}
          {totpEnabled}
          twoFactorEnabled={totpEnabled || otherTwoFactorEnabled}
          isAdmin={vault.profile?.role === "admin"}
          {recoveryCode}
          {busy}
          onCopy={copy}
          onChangePassword={() => (passwordOpen = true)}
          onShowRecoveryCode={() => requestSensitiveAction("recovery")}
          onDisableTwoFactor={() => (disableOpen = true)}
          onBeginTotp={() => requestSensitiveAction("totp")}
          onMessage={(value) => {
            message = value;
            error = "";
          }}
          onError={fail}
          onSessionRevoked={async (reason) => {
            await logout();
            await goto(`/login?reason=${reason}`);
          }}
        /></Tabs.Content
      >
      <Tabs.Content value="devices"
        ><DeviceManager
          bind:devices
          {passwordHash}
          onMessage={(value) => {
            message = value;
            error = "";
          }}
          onError={fail}
          onSessionRevoked={async (reason) => {
            await logout();
            await goto(`/login?reason=${reason}`);
          }}
        /></Tabs.Content
      >
      <Tabs.Content value="danger"
        ><Card.Root class="border-destructive/40"
          ><Card.Header
            ><Card.Title>{m.ui_delete_account()}</Card.Title><Card.Description
              >{m.ui_permanently_delete_your_personal_vault_sends_devices_passkeys_and_account_detail()}</Card.Description
            ></Card.Header
          ><Card.Content
            ><Button variant="destructive" onclick={() => (deleteAccountOpen = true)}
              >{m.ui_permanently_delete_account()}</Button
            ></Card.Content
          ></Card.Root
        ></Tabs.Content
      >
    </Tabs.Root>
  {/if}
</VaultPageShell>

<AccountSecurityDialogs
  bind:deleteAccountOpen
  bind:deleteAccountPassword
  bind:totpOpen
  {totpKey}
  bind:totpToken
  bind:verificationOpen
  bind:verificationPassword
  {verificationAction}
  bind:recoveryOpen
  {recoveryCode}
  bind:recoveryConfirmed
  bind:disableOpen
  bind:masterPassword
  bind:passwordOpen
  bind:currentPassword
  bind:newPassword
  bind:confirmPassword
  {busy}
  onCopy={copy}
  onDeleteAccount={removeAccount}
  onEnableTotp={enableTotp}
  onCancelTotp={resetTotpSetup}
  onVerifySensitiveAction={verifySensitiveAction}
  onFinishRecoverySetup={finishRecoverySetup}
  onDisableTotp={disableTotp}
  onChangePassword={changeMasterPassword}
/>

<AlertDialog.Root bind:open={rotateApiKeyOpen}
  ><AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_rotate_api_key()}</AlertDialog.Title><AlertDialog.Description
        >{m.ui_your_old_api_key_will_stop_working_immediately_update_all_clients_that_use_it()}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        onclick={() => {
          rotateApiKeyOpen = false;
          requestSensitiveAction("api-key-rotate");
        }}>{m.ui_confirm_rotation()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  ></AlertDialog.Root
>
