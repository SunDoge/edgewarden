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
	isLoggedIn,
	rotateApiKeyApi,
	updateProfileApi,
} from "$lib/services/api";
import {
	deriveMasterKey,
	deriveMasterPasswordHash,
} from "$lib/services/crypto";
import { vault, syncVaultData, logout } from "$lib/stores/vault.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import AccountPasskeys from "$lib/components/settings/AccountPasskeys.svelte";
import AccountSecurityDialogs from "$lib/components/settings/AccountSecurityDialogs.svelte";
import AuthRequestSettings from "$lib/components/settings/AuthRequestSettings.svelte";
import DeviceManager from "$lib/components/settings/DeviceManager.svelte";
import TwoFactorPasskeys from "$lib/components/settings/TwoFactorPasskeys.svelte";
import YubikeySettings from "$lib/components/settings/YubikeySettings.svelte";
import { Input } from "$lib/components/ui/input/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Select from "$lib/components/ui/select/index.js";
import { Badge } from "$lib/components/ui/badge/index.js";
import {
	applyThemePreference,
	loadClientPreferences,
	saveClientPreferences,
	type SessionTimeoutAction,
	type ThemePreference,
} from "$lib/services/client-preferences";
import {
	ArrowLeft,
	Copy,
	KeyRound,
	LoaderCircle,
	RefreshCw,
	ShieldCheck,
} from "@lucide/svelte";

let loading = $state(true);
let busy = $state("");
let message = $state("");
let error = $state("");
let profile = $state<any>(null);
let devices = $state<any[]>([]);
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
	if (!isLoggedIn()) return goto("/login");
	if (!vault.isUnlocked) return goto("/vault/unlock");
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
	const key = await deriveMasterKey(
		password,
		profile.email,
		profile.kdfIterations,
	);
	return deriveMasterPasswordHash(key, password);
}

async function changeMasterPassword() {
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

<main class="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-8">
	<header class="flex items-center gap-3">
		<Button variant="ghost" size="icon" onclick={() => goto("/vault")} aria-label="返回保险库"><ArrowLeft /></Button>
		<div><h1 class="text-2xl font-semibold">账户与安全</h1><p class="text-sm text-muted-foreground">管理资料、API Key、两步验证和登录设备。</p></div>
	</header>

	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if message}<div class="rounded-md border border-border bg-muted p-3 text-sm">{message}</div>{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-12 text-muted-foreground"><LoaderCircle class="animate-spin" />正在加载账户设置…</div>
	{:else if profile}
		<Card.Root>
			<Card.Header><Card.Title>外观与会话</Card.Title><Card.Description>偏好仅保存在此浏览器，不包含密码或保险库密钥。</Card.Description></Card.Header>
			<Card.Content>
				<Field.Group>
					<Field.Field><Field.Label>主题</Field.Label><Select.Root type="single" bind:value={theme}><Select.Trigger>{theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="system">跟随系统</Select.Item><Select.Item value="light">浅色</Select.Item><Select.Item value="dark">深色</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field>
					<Field.Field><Field.Label>无操作后</Field.Label><Select.Root type="single" bind:value={lockTimeoutMinutes}><Select.Trigger>{lockTimeoutMinutes === "0" ? "永不" : `${lockTimeoutMinutes} 分钟`}</Select.Trigger><Select.Content><Select.Group><Select.Item value="1">1 分钟</Select.Item><Select.Item value="5">5 分钟</Select.Item><Select.Item value="15">15 分钟</Select.Item><Select.Item value="30">30 分钟</Select.Item><Select.Item value="0">永不</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field>
					<Field.Field><Field.Label>超时操作</Field.Label><Select.Root type="single" bind:value={sessionTimeoutAction}><Select.Trigger>{sessionTimeoutAction === "lock" ? "锁定保险库" : "退出登录"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="lock">锁定保险库</Select.Item><Select.Item value="logout">退出登录并清除离线缓存</Select.Item></Select.Group></Select.Content></Select.Root><Field.Description>“锁定”保留加密离线缓存；“退出”会同时清除缓存和令牌。</Field.Description></Field.Field>
					<Field.Field orientation="horizontal"><Button onclick={saveLocalPreferences}>保存偏好</Button></Field.Field>
				</Field.Group>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>个人资料</Card.Title><Card.Description>{profile.email}</Card.Description></Card.Header>
			<Card.Content>
				<form onsubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
					<Field.Group>
						<Field.Field><Field.Label for="name">显示名称</Field.Label><Input id="name" bind:value={name} autocomplete="name" /></Field.Field>
						<Field.Field><Field.Label for="hint">主密码提示</Field.Label><Input id="hint" bind:value={hint} /><Field.Description>提示不会通过此页面直接显示给未登录用户。</Field.Description></Field.Field>
						<Field.Field orientation="horizontal"><Button type="submit" disabled={busy === "profile"}>{busy === "profile" ? "保存中…" : "保存资料"}</Button></Field.Field>
					</Field.Group>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>API Key</Card.Title><Card.Description>用于受信任的客户端集成，请勿公开。</Card.Description></Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#if apiKey}<div class="flex gap-2"><Input value={apiKey} readonly class="font-mono" /><Button variant="outline" size="icon" onclick={() => copy(apiKey)} aria-label="复制 API Key"><Copy data-icon /></Button></div>{/if}
				<div class="flex gap-2"><Button variant="outline" onclick={revealApiKey} disabled={busy === "api-key"}><KeyRound data-icon="inline-start" />{apiKey ? "重新读取" : "显示 API Key"}</Button><Button variant="outline" onclick={() => rotateApiKeyOpen = true} disabled={busy === "api-key"}><RefreshCw data-icon="inline-start" />轮换</Button></div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>主密码</Card.Title><Card.Description>更改后会重新保护保险库密钥，并退出所有设备。</Card.Description></Card.Header>
			<Card.Content><Button variant="outline" onclick={() => passwordOpen = true}>更改主密码</Button></Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>两步验证</Card.Title><Card.Description>使用兼容 TOTP 的身份验证器保护登录。</Card.Description></Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="flex items-center gap-2"><Badge variant={profile.twoFactorEnabled ? "default" : "secondary"}>{profile.twoFactorEnabled ? "已启用" : "未启用"}</Badge></div>
				{#if recoveryCode}<div class="flex gap-2"><Input value={recoveryCode} readonly class="font-mono" /><Button variant="outline" size="icon" onclick={() => copy(recoveryCode)} aria-label="复制恢复代码"><Copy /></Button></div>{/if}
				<div class="flex flex-wrap gap-2">
					{#if profile.twoFactorEnabled}<Button variant="outline" onclick={showRecoveryCode} disabled={busy === "recovery"}>查看恢复代码</Button><Button variant="destructive" onclick={() => disableOpen = true}>关闭两步验证</Button>{:else}<Button onclick={beginTotp} disabled={busy === "totp"}><ShieldCheck />设置身份验证器</Button>{/if}
				</div>
			</Card.Content>
		</Card.Root>

		<TwoFactorPasskeys
			email={profile.email}
			kdfIterations={profile.kdfIterations}
			onMessage={(value) => { message = value; error = ""; }}
			onError={fail}
		/>

		<YubikeySettings
			email={profile.email}
			kdfIterations={profile.kdfIterations}
			isAdmin={profile.role === "admin"}
			onMessage={(value) => { message = value; error = ""; }}
			onError={fail}
		/>

		<AccountPasskeys
			email={profile.email}
			kdfIterations={profile.kdfIterations}
			onMessage={(value) => { message = value; error = ""; }}
			onError={fail}
		/>

		<AuthRequestSettings
			email={profile.email}
			onMessage={(value) => { message = value; error = ""; }}
			onError={fail}
		/>

		<DeviceManager
			bind:devices
			{passwordHash}
			onMessage={(value) => { message = value; error = ""; }}
			onError={fail}
			onSessionRevoked={async (reason) => { await logout(); await goto(`/login?reason=${reason}`); }}
		/>

		<Card.Root class="border-destructive/40">
			<Card.Header><Card.Title>删除账户</Card.Title><Card.Description>永久删除个人保险库、Sends、设备、通行密钥和账户资料。若你仍拥有组织，必须先删除或转移组织。</Card.Description></Card.Header>
			<Card.Content><Button variant="destructive" onclick={() => deleteAccountOpen = true}>永久删除账户</Button></Card.Content>
		</Card.Root>
	{/if}
</main>

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
