<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import {
  deleteAccountApi,
  disableTwoFactorApi,
  enableAuthenticatorApi,
  changeMasterPasswordApi,
  fetchApiKeyApi,
  fetchDevicesApi,
  fetchProfileApi,
  fetchRecoveryCodeApi,
  getAuthenticatorApi,
  rotateApiKeyApi,
  updateProfileApi,
} from "$lib/services/api-account";
import {
  deriveMasterKey,
  deriveMasterPasswordHash,
} from "$lib/services/crypto";
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
import type {
  AccountDevice,
  AccountProfile,
} from "$lib/services/account-types";

let loading = $state(true);
let busy = $state("");
let message = $state("");
let error = $state("");
let profile = $state<AccountProfile | null>(null);
let devices = $state<AccountDevice[]>([]);
let apiKey = $state("");
let name = $state("");
let hint = $state("");
let deleteAccountOpen = $state(false);
let deleteAccountPassword = $state("");
let totpOpen = $state(false);
let totpKey = $state("");
let totpToken = $state("");
let disableOpen = $state(false);
let masterPassword = $state("");
let recoveryCode = $state("");
let passwordOpen = $state(false);
let currentPassword = $state("");
let newPassword = $state("");
let confirmPassword = $state("");
let theme = $state<ThemePreference>("system");
let lockTimeoutMinutes = $state<"0" | "1" | "5" | "15" | "30">("15");
let sessionTimeoutAction = $state<SessionTimeoutAction>("lock");
let rotateApiKeyOpen = $state(false);

function fail(value: unknown) {
  error = value instanceof Error ? value.message : "操作失败";
  message = "";
}

async function load() {
  loading = true;
  error = "";
  try {
    [profile, { data: devices }] = await Promise.all([
      fetchProfileApi(),
      fetchDevicesApi(),
    ]);
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
  lockTimeoutMinutes = String(
    preferences.lockTimeoutMinutes,
  ) as typeof lockTimeoutMinutes;
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
  message = "外观和会话策略已保存";
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
    message = "个人资料已保存";
  } catch (e) {
    fail(e);
  } finally {
    busy = "";
  }
}

async function revealApiKey() {
  busy = "api-key";
  try {
    apiKey = (await fetchApiKeyApi()).apiKey;
  } catch (e) {
    fail(e);
  } finally {
    busy = "";
  }
}

async function rotateApiKey() {
  rotateApiKeyOpen = false;
  busy = "api-key";
  try {
    apiKey = (await rotateApiKeyApi()).apiKey;
    message = "API Key 已轮换";
  } catch (e) {
    fail(e);
  } finally {
    busy = "";
  }
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  message = "已复制到剪贴板";
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

async function beginTotp() {
  busy = "totp";
  try {
    const result = await getAuthenticatorApi();
    totpKey = result.key;
    totpToken = "";
    totpOpen = true;
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
    await enableAuthenticatorApi(totpKey, totpToken.replace(/\s/g, ""));
    profile.twoFactorEnabled = true;
    totpOpen = false;
    message = "身份验证器已启用，请保存恢复代码";
    const result = await fetchRecoveryCodeApi();
    recoveryCode = result.code ?? "";
  } catch (e) {
    fail(e);
  } finally {
    busy = "";
  }
}

async function showRecoveryCode() {
  busy = "recovery";
  try {
    recoveryCode = (await fetchRecoveryCodeApi()).code ?? "";
  } catch (e) {
    fail(e);
  } finally {
    busy = "";
  }
}

async function disableTotp() {
  if (!profile || !masterPassword) return;
  busy = "totp-disable";
  try {
    const key = await deriveMasterKey(
      masterPassword,
      profile.email,
      profile.kdfIterations,
    );
    const hash = await deriveMasterPasswordHash(key, masterPassword);
    await disableTwoFactorApi(hash);
    profile.twoFactorEnabled = false;
    disableOpen = false;
    masterPassword = "";
    recoveryCode = "";
    message = "两步验证已关闭";
  } catch (e) {
    fail(e);
  } finally {
    busy = "";
  }
}

async function passwordHash(password: string): Promise<string> {
  if (!profile) throw new Error("账户资料尚未载入");
  const key = await deriveMasterKey(
    password,
    profile.email,
    profile.kdfIterations,
  );
  return deriveMasterPasswordHash(key, password);
}

async function changeMasterPassword() {
  if (!profile) return fail(new Error("账户资料尚未载入"));
  if (newPassword.length < 12)
    return fail(new Error("新主密码至少需要 12 个字符"));
  if (newPassword !== confirmPassword)
    return fail(new Error("两次输入的新主密码不一致"));
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

<svelte:head><title>账户与安全 · Edgewarden</title></svelte:head>

<VaultPageShell title="账户与安全" description="管理资料、API Key、两步验证和登录设备。" width="default">
	{#if error}<Alert.Root variant="destructive"><Alert.Title>操作失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
	{#if message}<Alert.Root><Alert.Title>设置已更新</Alert.Title><Alert.Description>{message}</Alert.Description></Alert.Root>{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-muted-foreground"><LoaderCircle class="animate-spin" />正在加载账户设置…</div>
	{:else if profile}
		<Tabs.Root value="general" class="flex flex-col gap-6">
			<Tabs.List class="grid h-auto w-full grid-cols-2 sm:grid-cols-4"><Tabs.Trigger value="general">常规</Tabs.Trigger><Tabs.Trigger value="security">安全</Tabs.Trigger><Tabs.Trigger value="devices">设备</Tabs.Trigger><Tabs.Trigger value="danger">危险区域</Tabs.Trigger></Tabs.List>
			<Tabs.Content value="general"><SettingsGeneralPanel email={profile.email} bind:theme bind:lockTimeoutMinutes bind:sessionTimeoutAction bind:name bind:hint {apiKey} {busy} onSavePreferences={saveLocalPreferences} onSaveProfile={saveProfile} onCopy={copy} onRevealApiKey={revealApiKey} onRotateApiKey={() => rotateApiKeyOpen = true} /></Tabs.Content>
			<Tabs.Content value="security"><SettingsSecurityPanel {profile} isAdmin={vault.profile?.role === "admin"} {recoveryCode} {busy} onCopy={copy} onChangePassword={() => passwordOpen = true} onShowRecoveryCode={showRecoveryCode} onDisableTwoFactor={() => disableOpen = true} onBeginTotp={beginTotp} onMessage={(value) => { message = value; error = ""; }} onError={fail} /></Tabs.Content>
			<Tabs.Content value="devices"><DeviceManager bind:devices {passwordHash} onMessage={(value) => { message = value; error = ""; }} onError={fail} onSessionRevoked={async (reason) => { await logout(); await goto(`/login?reason=${reason}`); }} /></Tabs.Content>
			<Tabs.Content value="danger"><Card.Root class="border-destructive/40"><Card.Header><Card.Title>删除账户</Card.Title><Card.Description>永久删除个人保险库、Sends、设备、通行密钥和账户资料。若你仍拥有组织，必须先删除或转移组织。</Card.Description></Card.Header><Card.Content><Button variant="destructive" onclick={() => deleteAccountOpen = true}>永久删除账户</Button></Card.Content></Card.Root></Tabs.Content>
		</Tabs.Root>
	{/if}
</VaultPageShell>

<AccountSecurityDialogs
	bind:deleteAccountOpen
	bind:deleteAccountPassword
	bind:totpOpen
	{totpKey}
	bind:totpToken
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
	onDisableTotp={disableTotp}
	onChangePassword={changeMasterPassword}
/>

<AlertDialog.Root bind:open={rotateApiKeyOpen}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>轮换 API Key</AlertDialog.Title><AlertDialog.Description>旧 API Key 会立即失效，所有使用旧密钥的客户端都需要重新配置。</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action onclick={rotateApiKey}>确认轮换</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
