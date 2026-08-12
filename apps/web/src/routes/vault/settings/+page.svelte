<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import {
	deleteAllDevicesApi,
	deleteAccountApi,
	deleteDeviceApi,
	deleteDevicesApi,
	disableTwoFactorApi,
	enableAuthenticatorApi,
	changeMasterPasswordApi,
	createAccountPasskeyApi,
	deleteAccountPasskeyApi,
	deleteTwoFactorPasskeyApi,
	fetchApiKeyApi,
	fetchDevicesApi,
	fetchProfileApi,
	fetchRecoveryCodeApi,
	getAuthenticatorApi,
	getAccountPasskeyAttestationOptionsApi,
	getAccountPasskeyAssertionOptionsApi,
	getTwoFactorPasskeysApi,
	getTwoFactorPasskeyChallengeApi,
	createTwoFactorPasskeyApi,
	isLoggedIn,
	listAccountPasskeysApi,
	renameDeviceApi,
	rotateApiKeyApi,
	updateProfileApi,
	updateAccountPasskeyEncryptionApi,
} from "$lib/services/api";
import {
	bytesToBase64,
	deriveMasterKey,
	deriveMasterPasswordHash,
} from "$lib/services/crypto";
import {
	assertAccountPasskey,
	buildAccountPasskeyPrfKeySet,
	buildAccountPasskeyPrfKeySetFromPrfKey,
	createAccountPasskeyCredential,
	createTwoFactorPasskeyCredential,
} from "$lib/services/passkeys";
import {
	encryptVaultKeyForAuthRequest,
	listPendingAuthRequestsApi,
	respondToAuthRequestApi,
	type AuthRequest,
} from "$lib/services/auth-requests";
import { vault, syncVaultData, logout } from "$lib/stores/vault.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import YubikeySettings from "$lib/components/settings/YubikeySettings.svelte";
import { Input } from "$lib/components/ui/input/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import * as Table from "$lib/components/ui/table/index.js";
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
	Fingerprint,
	KeyRound,
	LoaderCircle,
	Pencil,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from "@lucide/svelte";
import { match } from "ts-pattern";
import { getCurrentDeviceIdentifier } from "$lib/services/client-device";

let loading = $state(true);
let busy = $state("");
let message = $state("");
let error = $state("");
let profile = $state<any>(null);
let devices = $state<any[]>([]);
let passkeys = $state<any[]>([]);
let authRequests = $state<AuthRequest[]>([]);
let apiKey = $state("");
let name = $state("");
let hint = $state("");
let editingDevice = $state<any>(null);
let deviceName = $state("");
let removeAllDevicesOpen = $state(false);
let removeAllDevicesPassword = $state("");
let deleteAccountOpen = $state(false);
let deleteAccountPassword = $state("");
let selectedDeviceIds = $state<Record<string, boolean>>({});
let selectedDeviceIdList = $derived(
	devices
		.filter((device) => selectedDeviceIds[device.id])
		.map((device) => device.id),
);
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
let passkeyOpen = $state(false);
let passkeyName = $state("");
let passkeyPassword = $state("");
let deletePasskey = $state<any>(null);
let deletePasskeyPassword = $state("");
let enablePasskey = $state<any>(null);
let enablePasskeyPassword = $state("");
let theme = $state<ThemePreference>("system");
let lockTimeoutMinutes = $state<"0" | "1" | "5" | "15" | "30">("15");
let sessionTimeoutAction = $state<SessionTimeoutAction>("lock");
let twoFactorPasskeys = $state<any[]>([]);
let twoFactorPasskeyOpen = $state(false);
let twoFactorPasskeyPassword = $state("");
let twoFactorPasskeyName = $state("");

function fail(value: unknown) {
	error = value instanceof Error ? value.message : "操作失败";
	message = "";
}

async function load() {
	loading = true;
	error = "";
	try {
		[profile, { data: devices }, { data: passkeys }] = await Promise.all([
			fetchProfileApi(),
			fetchDevicesApi(),
			listAccountPasskeysApi(),
		]);
		name = profile.name ?? "";
		hint = profile.masterPasswordHint ?? "";
		authRequests = await listPendingAuthRequestsApi(profile.email);
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
	if (!confirm("旧 API Key 会立即失效，确认轮换？")) return;
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

function startRename(device: any) {
	editingDevice = device;
	deviceName = device.name ?? "";
}

async function saveDeviceName() {
	if (!editingDevice || !deviceName.trim()) return;
	busy = `device-${editingDevice.id}`;
	try {
		await renameDeviceApi(editingDevice.id, deviceName.trim());
		editingDevice = null;
		devices = (await fetchDevicesApi()).data;
		message = "设备名称已更新";
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

async function removeDevice(device: any) {
	if (!confirm(`移除设备“${device.name}”？`)) return;
	busy = `device-${device.id}`;
	try {
		await deleteDeviceApi(device.id);
		devices = devices.filter((item) => item.id !== device.id);
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

async function removeSelectedDevices() {
	if (
		!selectedDeviceIdList.length ||
		!confirm(`移除选中的 ${selectedDeviceIdList.length} 台设备并撤销其会话？`)
	)
		return;
	const removesCurrent = selectedDeviceIdList.includes(
		getCurrentDeviceIdentifier(),
	);
	busy = "selected-devices";
	try {
		await deleteDevicesApi(selectedDeviceIdList);
		devices = devices.filter((device) => !selectedDeviceIds[device.id]);
		selectedDeviceIds = {};
		message = "已移除选中设备";
		if (removesCurrent) {
			await logout();
			await goto("/login?reason=device-removed");
		}
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

function toggleAllDevices(checked: boolean) {
	selectedDeviceIds = checked
		? Object.fromEntries(devices.map((device) => [device.id, true]))
		: {};
}

async function removeAllDevices() {
	if (!removeAllDevicesPassword) return;
	busy = "devices";
	try {
		await deleteAllDevicesApi(await passwordHash(removeAllDevicesPassword));
		devices = [];
		removeAllDevicesOpen = false;
		removeAllDevicesPassword = "";
		await logout();
		await goto("/login?reason=devices-removed");
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
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

async function createPasskey() {
	if (!passkeyPassword) return;
	busy = "passkey-create";
	try {
		const hash = await passwordHash(passkeyPassword);
		const options = await getAccountPasskeyAttestationOptionsApi(hash);
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
			} catch (e) {
				if (
					!confirm(
						"无法为这把通行密钥启用保险库直接解锁。仍保存为仅登录通行密钥？",
					)
				)
					throw e;
			}
		}
		await createAccountPasskeyApi({
			token: pending.token,
			deviceResponse: pending.request,
			name: passkeyName.trim() || undefined,
			supportsPrf: pending.supportsPrf && !!keySet.encryptedUserKey,
			...keySet,
		});
		passkeys = (await listAccountPasskeysApi()).data;
		passkeyOpen = false;
		passkeyName = "";
		passkeyPassword = "";
		message = "通行密钥已添加";
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

async function removePasskey() {
	if (!deletePasskey || !deletePasskeyPassword) return;
	busy = "passkey-delete";
	try {
		await deleteAccountPasskeyApi(
			deletePasskey.id,
			await passwordHash(deletePasskeyPassword),
		);
		passkeys = passkeys.filter((item) => item.id !== deletePasskey.id);
		deletePasskey = null;
		deletePasskeyPassword = "";
		message = "通行密钥已删除";
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

async function enablePasskeyDirectUnlock() {
	if (
		!enablePasskey ||
		!enablePasskeyPassword ||
		!vault.symEncKey ||
		!vault.symMacKey
	)
		return;
	busy = "passkey-enable";
	try {
		const assertion = await assertAccountPasskey(
			await getAccountPasskeyAssertionOptionsApi(
				await passwordHash(enablePasskeyPassword),
				enablePasskey.id,
			),
		);
		if (!assertion.prfKey)
			throw new Error("这把通行密钥没有返回 PRF 密钥，无法启用直接解锁");
		const keySet = await buildAccountPasskeyPrfKeySetFromPrfKey(
			assertion.prfKey,
			{
				symEncKey: bytesToBase64(vault.symEncKey),
				symMacKey: bytesToBase64(vault.symMacKey),
			},
		);
		await updateAccountPasskeyEncryptionApi({
			token: assertion.token,
			deviceResponse: assertion.deviceResponse,
			...keySet,
		});
		passkeys = (await listAccountPasskeysApi()).data;
		enablePasskey = null;
		enablePasskeyPassword = "";
		message = "已启用通行密钥直接解锁";
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

async function manageTwoFactorPasskeys() {
	if (!twoFactorPasskeyPassword) return;
	busy = "2fa-passkey-load";
	try {
		const result = await getTwoFactorPasskeysApi(
			await passwordHash(twoFactorPasskeyPassword),
		);
		twoFactorPasskeys = result.keys ?? result.Keys ?? [];
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

async function addTwoFactorPasskey() {
	if (!twoFactorPasskeyPassword) return;
	busy = "2fa-passkey-create";
	try {
		const masterPasswordHash = await passwordHash(twoFactorPasskeyPassword);
		const credential = await createTwoFactorPasskeyCredential(
			await getTwoFactorPasskeyChallengeApi(masterPasswordHash),
		);
		const result = await createTwoFactorPasskeyApi({
			masterPasswordHash,
			name: twoFactorPasskeyName.trim() || "安全密钥",
			...credential,
		});
		twoFactorPasskeys = result.keys ?? result.Keys ?? [];
		twoFactorPasskeyName = "";
		message = "两步验证安全密钥已添加";
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

async function removeTwoFactorPasskey(id: string) {
	if (!twoFactorPasskeyPassword || !confirm("删除这把两步验证安全密钥？"))
		return;
	busy = `2fa-passkey-${id}`;
	try {
		const result = await deleteTwoFactorPasskeyApi({
			id,
			masterPasswordHash: await passwordHash(twoFactorPasskeyPassword),
		});
		twoFactorPasskeys = result.keys ?? result.Keys ?? [];
		message = "两步验证安全密钥已删除";
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

function deviceTypeLabel(type: number): string {
	return match(type)
		.with(0, () => "浏览器")
		.with(1, () => "Android")
		.with(2, () => "iOS")
		.with(3, () => "桌面客户端")
		.otherwise(() => `设备类型 ${type}`);
}

async function refreshAuthRequests() {
	busy = "auth-requests";
	try {
		authRequests = await listPendingAuthRequestsApi(profile.email);
	} catch (e) {
		fail(e);
	} finally {
		busy = "";
	}
}

async function respondToAuthRequest(request: AuthRequest, approved: boolean) {
	busy = `auth-request-${request.id}`;
	try {
		let key: string | undefined;
		if (approved) {
			if (!vault.symEncKey || !vault.symMacKey)
				throw new Error("保险库密钥不可用，请重新解锁");
			key = await encryptVaultKeyForAuthRequest(
				request.publicKey,
				vault.symEncKey,
				vault.symMacKey,
			);
		}
		await respondToAuthRequestApi(request.id, approved, key);
		authRequests = authRequests.filter((item) => item.id !== request.id);
		message = approved ? "已批准设备登录" : "已拒绝设备登录";
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
				{#if apiKey}<div class="flex gap-2"><Input value={apiKey} readonly class="font-mono" /><Button variant="outline" size="icon" onclick={() => copy(apiKey)} aria-label="复制 API Key"><Copy /></Button></div>{/if}
				<div class="flex gap-2"><Button variant="outline" onclick={revealApiKey} disabled={busy === "api-key"}><KeyRound />{apiKey ? "重新读取" : "显示 API Key"}</Button><Button variant="outline" onclick={rotateApiKey} disabled={busy === "api-key"}><RefreshCw />轮换</Button></div>
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

		<Card.Root>
			<Card.Header><Card.Title>两步验证安全密钥</Card.Title><Card.Description>这些凭据只作为第二因素，不能单独登录或解锁保险库。</Card.Description></Card.Header>
			<Card.Content><Button variant="outline" onclick={() => twoFactorPasskeyOpen = true}><Fingerprint />管理安全密钥</Button></Card.Content>
		</Card.Root>

		<YubikeySettings
			email={profile.email}
			kdfIterations={profile.kdfIterations}
			isAdmin={profile.role === "admin"}
			onMessage={(value) => { message = value; error = ""; }}
			onError={fail}
		/>

		<Card.Root>
			<Card.Header class="flex-row items-start justify-between"><div><Card.Title>通行密钥</Card.Title><Card.Description>最多添加 5 把 WebAuthn 通行密钥；支持 PRF 的设备可直接解锁保险库。</Card.Description></div><Button size="sm" onclick={() => passkeyOpen = true} disabled={passkeys.length >= 5}>添加</Button></Card.Header>
			<Card.Content class="flex flex-col gap-2">
				{#each passkeys as passkey (passkey.id)}
					<div class="flex items-center justify-between gap-3 rounded-md border p-3"><div><div class="font-medium">{passkey.name || "通行密钥"}</div><div class="text-xs text-muted-foreground">{passkey.creationDate ? new Date(passkey.creationDate).toLocaleString() : ""}</div></div><div class="flex items-center gap-2"><Badge variant={passkey.prfStatus === 0 ? "default" : "secondary"}>{passkey.prfStatus === 0 ? "可直接解锁" : passkey.prfStatus === 1 ? "可启用直接解锁" : "仅登录"}</Badge>{#if passkey.prfStatus === 1}<Button variant="outline" size="sm" onclick={() => enablePasskey = passkey}><ShieldCheck />启用直接解锁</Button>{/if}<Button variant="ghost" size="icon-sm" onclick={() => deletePasskey = passkey} aria-label="删除通行密钥"><Trash2 /></Button></div></div>
				{:else}<p class="py-4 text-sm text-muted-foreground">尚未添加通行密钥。</p>{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-start justify-between"><div><Card.Title>待审批设备登录</Card.Title><Card.Description>批准前请在请求设备上核对公钥指纹和设备信息。</Card.Description></div><Button variant="outline" size="sm" onclick={refreshAuthRequests} disabled={busy === "auth-requests"}><RefreshCw class={busy === "auth-requests" ? "animate-spin" : ""} />刷新</Button></Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#each authRequests as request (request.id)}
					<div class="flex flex-col gap-3 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
						<div class="min-w-0"><div class="font-medium">{deviceTypeLabel(request.requestDeviceType)}</div><div class="truncate text-xs text-muted-foreground">{request.requestDeviceIdentifier}</div><div class="text-xs text-muted-foreground">{new Date(request.creationDate).toLocaleString()}{request.requestIpAddress ? ` · ${request.requestIpAddress}` : ""}</div><code class="mt-2 block break-all text-xs">{request.fingerprint || "指纹不可用"}</code></div>
						<div class="flex shrink-0 gap-2"><Button size="sm" onclick={() => respondToAuthRequest(request, true)} disabled={busy.startsWith("auth-request-")}><ShieldCheck />批准</Button><Button size="sm" variant="destructive" onclick={() => respondToAuthRequest(request, false)} disabled={busy.startsWith("auth-request-")}>拒绝</Button></div>
					</div>
				{:else}<p class="py-4 text-sm text-muted-foreground">没有待审批的设备登录。</p>{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-start justify-between"><div><Card.Title>设备</Card.Title><Card.Description>查看并撤销已登录设备。</Card.Description></div><div class="flex gap-2">{#if selectedDeviceIdList.length}<Button variant="destructive" size="sm" onclick={removeSelectedDevices} disabled={busy === "selected-devices"}>移除已选（{selectedDeviceIdList.length}）</Button>{/if}<Button variant="destructive" size="sm" onclick={() => removeAllDevicesOpen = true} disabled={!devices.length || busy === "devices"}>移除全部</Button></div></Card.Header>
			<Card.Content>
				<Table.Root><Table.Header><Table.Row><Table.Head class="w-10"><input type="checkbox" aria-label="选择全部设备" checked={devices.length > 0 && selectedDeviceIdList.length === devices.length} onchange={(event) => toggleAllDevices(event.currentTarget.checked)} /></Table.Head><Table.Head>名称</Table.Head><Table.Head>最近登录</Table.Head><Table.Head>密钥状态</Table.Head><Table.Head class="text-right">操作</Table.Head></Table.Row></Table.Header><Table.Body>
					{#each devices as device (device.id)}<Table.Row><Table.Cell><input type="checkbox" aria-label={`选择设备 ${device.name}`} checked={!!selectedDeviceIds[device.id]} onchange={(event) => selectedDeviceIds = { ...selectedDeviceIds, [device.id]: event.currentTarget.checked }} /></Table.Cell><Table.Cell><div class="font-medium">{device.name}{device.id === getCurrentDeviceIdentifier() ? "（当前）" : ""}</div><div class="text-xs text-muted-foreground">{device.identifier}</div></Table.Cell><Table.Cell>{device.lastLoginDate ? new Date(device.lastLoginDate).toLocaleString() : "—"}</Table.Cell><Table.Cell><Badge variant="outline">{device.isTrusted ? "已保存设备密钥" : "未保存设备密钥"}</Badge></Table.Cell><Table.Cell><div class="flex justify-end gap-1"><Button variant="ghost" size="icon-sm" onclick={() => startRename(device)} aria-label="重命名设备"><Pencil /></Button><Button variant="ghost" size="icon-sm" onclick={() => removeDevice(device)} disabled={busy === `device-${device.id}`} aria-label="移除设备"><Trash2 /></Button></div></Table.Cell></Table.Row>{:else}<Table.Row><Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">暂无设备记录</Table.Cell></Table.Row>{/each}
				</Table.Body></Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-destructive/40">
			<Card.Header><Card.Title>删除账户</Card.Title><Card.Description>永久删除个人保险库、Sends、设备、通行密钥和账户资料。若你仍拥有组织，必须先删除或转移组织。</Card.Description></Card.Header>
			<Card.Content><Button variant="destructive" onclick={() => deleteAccountOpen = true}>永久删除账户</Button></Card.Content>
		</Card.Root>
	{/if}
</main>

<Dialog.Root open={!!editingDevice} onOpenChange={(open) => { if (!open) editingDevice = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>重命名设备</Dialog.Title><Dialog.Description>名称用于区分登录设备。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="device-name">设备名称</Field.Label><Input id="device-name" bind:value={deviceName} /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => editingDevice = null}>取消</Button><Button onclick={saveDeviceName} disabled={!deviceName.trim()}>保存</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root bind:open={removeAllDevicesOpen}><Dialog.Content><Dialog.Header><Dialog.Title>移除全部设备</Dialog.Title><Dialog.Description>所有刷新令牌都会撤销，当前浏览器也会退出。请输入主密码确认。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="remove-devices-password">当前主密码</Field.Label><Input id="remove-devices-password" type="password" bind:value={removeAllDevicesPassword} autocomplete="current-password" /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => removeAllDevicesOpen = false}>取消</Button><Button variant="destructive" onclick={removeAllDevices} disabled={!removeAllDevicesPassword || busy === "devices"}>移除并退出</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root bind:open={deleteAccountOpen}><Dialog.Content><Dialog.Header><Dialog.Title>永久删除账户</Dialog.Title><Dialog.Description>此操作无法撤销。服务器会删除个人保险库及账户数据，并清理附件和 Send 文件。请输入当前主密码确认。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="delete-account-password">当前主密码</Field.Label><Input id="delete-account-password" type="password" bind:value={deleteAccountPassword} autocomplete="current-password" /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => deleteAccountOpen = false}>取消</Button><Button variant="destructive" onclick={removeAccount} disabled={!deleteAccountPassword || busy === "delete-account"}>永久删除</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root bind:open={totpOpen}><Dialog.Content><Dialog.Header><Dialog.Title>设置身份验证器</Dialog.Title><Dialog.Description>在身份验证器中手动输入密钥，再填写生成的 6 位验证码。</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label>密钥</Field.Label><div class="flex gap-2"><Input value={totpKey} readonly class="font-mono" /><Button variant="outline" size="icon" onclick={() => copy(totpKey)} aria-label="复制密钥"><Copy /></Button></div></Field.Field><Field.Field><Field.Label for="totp-token">验证码</Field.Label><Input id="totp-token" bind:value={totpToken} inputmode="numeric" maxlength={6} autocomplete="one-time-code" /></Field.Field></Field.Group><Dialog.Footer><Button variant="outline" onclick={() => totpOpen = false}>取消</Button><Button onclick={enableTotp} disabled={!/^\d{6}$/.test(totpToken) || busy === "totp-enable"}>启用</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root bind:open={disableOpen}><Dialog.Content><Dialog.Header><Dialog.Title>关闭两步验证</Dialog.Title><Dialog.Description>请输入主密码确认。此操作会撤销现有刷新令牌。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="master-password">主密码</Field.Label><Input id="master-password" type="password" bind:value={masterPassword} autocomplete="current-password" /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => disableOpen = false}>取消</Button><Button variant="destructive" onclick={disableTotp} disabled={!masterPassword || busy === "totp-disable"}>确认关闭</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root bind:open={passwordOpen}><Dialog.Content><Dialog.Header><Dialog.Title>更改主密码</Dialog.Title><Dialog.Description>保险库密钥会使用新密码重新加密。完成后需要重新登录所有设备。</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label for="current-password">当前主密码</Field.Label><Input id="current-password" type="password" bind:value={currentPassword} autocomplete="current-password" /></Field.Field><Field.Field><Field.Label for="new-password">新主密码</Field.Label><Input id="new-password" type="password" bind:value={newPassword} autocomplete="new-password" /><Field.Description>至少 12 个字符。</Field.Description></Field.Field><Field.Field><Field.Label for="confirm-password">确认新主密码</Field.Label><Input id="confirm-password" type="password" bind:value={confirmPassword} autocomplete="new-password" /></Field.Field></Field.Group><Dialog.Footer><Button variant="outline" onclick={() => passwordOpen = false}>取消</Button><Button variant="destructive" onclick={changeMasterPassword} disabled={!currentPassword || newPassword.length < 12 || !confirmPassword || busy === "password"}>更改并退出</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root bind:open={passkeyOpen}><Dialog.Content><Dialog.Header><Dialog.Title>添加通行密钥</Dialog.Title><Dialog.Description>需要当前主密码验证身份，随后浏览器会打开 WebAuthn 提示。</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label for="passkey-name">名称</Field.Label><Input id="passkey-name" bind:value={passkeyName} placeholder="例如：MacBook Touch ID" /></Field.Field><Field.Field><Field.Label for="passkey-password">当前主密码</Field.Label><Input id="passkey-password" type="password" bind:value={passkeyPassword} autocomplete="current-password" /></Field.Field></Field.Group><Dialog.Footer><Button variant="outline" onclick={() => passkeyOpen = false}>取消</Button><Button onclick={createPasskey} disabled={!passkeyPassword || busy === "passkey-create"}>创建通行密钥</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root open={!!enablePasskey} onOpenChange={(open) => { if (!open) enablePasskey = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>启用直接解锁</Dialog.Title><Dialog.Description>验证主密码和这把通行密钥后，浏览器会使用 PRF 输出保护保险库密钥。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="enable-passkey-password">当前主密码</Field.Label><Input id="enable-passkey-password" type="password" bind:value={enablePasskeyPassword} autocomplete="current-password" /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => enablePasskey = null}>取消</Button><Button onclick={enablePasskeyDirectUnlock} disabled={!enablePasskeyPassword || busy === "passkey-enable"}>启用</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root bind:open={twoFactorPasskeyOpen}><Dialog.Content><Dialog.Header><Dialog.Title>两步验证安全密钥</Dialog.Title><Dialog.Description>先用主密码验证身份，再添加或删除安全密钥。</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label for="two-factor-passkey-password">当前主密码</Field.Label><Input id="two-factor-passkey-password" type="password" bind:value={twoFactorPasskeyPassword} autocomplete="current-password" /></Field.Field><Field.Field orientation="horizontal"><Button variant="outline" onclick={manageTwoFactorPasskeys} disabled={!twoFactorPasskeyPassword || busy === "2fa-passkey-load"}>读取设置</Button></Field.Field>{#if twoFactorPasskeys.length}<div class="space-y-2">{#each twoFactorPasskeys as credential (credential.id)}<div class="flex items-center justify-between rounded-md border p-3"><span>{credential.name || "安全密钥"}</span><Button variant="ghost" size="icon-sm" onclick={() => removeTwoFactorPasskey(String(credential.id))} disabled={busy === `2fa-passkey-${credential.id}`} aria-label="删除安全密钥"><Trash2 /></Button></div>{/each}</div>{/if}<Field.Field><Field.Label for="two-factor-passkey-name">新安全密钥名称</Field.Label><Input id="two-factor-passkey-name" bind:value={twoFactorPasskeyName} placeholder="例如：USB 安全密钥" /></Field.Field></Field.Group><Dialog.Footer><Button variant="outline" onclick={() => twoFactorPasskeyOpen = false}>关闭</Button><Button onclick={addTwoFactorPasskey} disabled={!twoFactorPasskeyPassword || busy === "2fa-passkey-create"}><Fingerprint />添加安全密钥</Button></Dialog.Footer></Dialog.Content></Dialog.Root>


<Dialog.Root open={!!deletePasskey} onOpenChange={(open) => { if (!open) deletePasskey = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>删除通行密钥</Dialog.Title><Dialog.Description>请输入当前主密码确认删除“{deletePasskey?.name || "通行密钥"}”。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="delete-passkey-password">当前主密码</Field.Label><Input id="delete-passkey-password" type="password" bind:value={deletePasskeyPassword} autocomplete="current-password" /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => deletePasskey = null}>取消</Button><Button variant="destructive" onclick={removePasskey} disabled={!deletePasskeyPassword || busy === "passkey-delete"}>删除</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
