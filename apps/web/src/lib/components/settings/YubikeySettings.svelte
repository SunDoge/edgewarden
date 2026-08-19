<script lang="ts">
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
import {
	deriveMasterKey,
	deriveMasterPasswordHash,
} from "$lib/services/crypto";
import type { YubikeySettingsResult } from "$lib/services/two-factor-types";

let {
	email,
	kdfIterations,
	isAdmin,
	onMessage,
	onError,
}: {
	email: string;
	kdfIterations: number;
	isAdmin: boolean;
	onMessage: (message: string) => void;
	onError: (error: unknown) => void;
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

async function passwordHash(): Promise<string> {
	const key = await deriveMasterKey(password, email, kdfIterations);
	return deriveMasterPasswordHash(key, password);
}

async function loadSettings() {
	if (!password) return;
	busy = "load";
	try {
		const result = await getYubikeySettingsApi(await passwordHash());
		settings = result;
		nfc = Boolean(result.nfc);
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}

async function save() {
	if (!password || !otps.trim()) return;
	busy = "save";
	try {
		settings = await saveYubikeysApi({
			masterPasswordHash: await passwordHash(),
			otps: otps.split(/\s+/).filter(Boolean),
			nfc,
		});
		otps = "";
		onMessage("YubiKey 两步验证已启用");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}

async function disable() {
	if (!password) return;
	disableConfirmOpen = false;
	busy = "disable";
	try {
		settings = await disableYubikeysApi(await passwordHash());
		onMessage("YubiKey 两步验证已关闭");
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
		onMessage("Yubico 验证凭据已加密保存");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}
</script>

<Card.Root>
	<Card.Header><Card.Title>YubiKey OTP</Card.Title><Card.Description>使用 Yubico OTP 模式的硬件密钥作为第二因素；登录时 OTP 会由服务端向 Yubico 验证。</Card.Description></Card.Header>
	<Card.Content><Button variant="outline" onclick={() => open = true}><KeyRound data-icon="inline-start" />管理 YubiKey</Button></Card.Content>
</Card.Root>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto">
		<Dialog.Header><Dialog.Title>YubiKey OTP</Dialog.Title><Dialog.Description>每把密钥触摸一次并逐行输入完整 OTP。服务器只保存前 12 位公共 ID。</Dialog.Description></Dialog.Header>
		<Field.Group>
			<Field.Field><Field.Label for="yubikey-password">当前主密码</Field.Label><Input id="yubikey-password" type="password" bind:value={password} autocomplete="current-password" /></Field.Field>
			<Field.Field orientation="horizontal"><Button variant="outline" onclick={loadSettings} disabled={!password || busy === "load"}>读取设置</Button></Field.Field>
			{#if settings}<div class="flex flex-col gap-2 rounded-md border p-3 text-sm"><div class="flex items-center justify-between"><span>状态</span><Badge variant={settings.enabled ? "default" : "secondary"}>{settings.enabled ? "已启用" : "未启用"}</Badge></div><div>已登记：{(settings.keys ?? []).join("、") || "无"}</div><div>Yubico 验证：{settings.configured ? "已配置" : "未配置"}</div></div>{/if}
			<Field.Field><Field.Label for="yubikey-otps">新 YubiKey OTP</Field.Label><Textarea id="yubikey-otps" bind:value={otps} rows={3} autocomplete="off" spellcheck={false} placeholder="每行输入一把密钥生成的 OTP（最多 5 把）" /></Field.Field>
			<Field.Field orientation="horizontal"><Switch id="yubikey-nfc" bind:checked={nfc} /><Field.Label for="yubikey-nfc">允许 NFC 提示</Field.Label></Field.Field>
			{#if isAdmin}<Field.FieldSet class="rounded-md border p-3"><Field.FieldLegend>Yubico 验证凭据（管理员）</Field.FieldLegend><Field.FieldGroup><Field.Field><Field.Label for="yubico-client-id">Client ID</Field.Label><Input id="yubico-client-id" bind:value={clientId} inputmode="numeric" /></Field.Field><Field.Field><Field.Label for="yubico-secret">Secret Key</Field.Label><Input id="yubico-secret" type="password" bind:value={secretKey} autocomplete="new-password" /></Field.Field><Button variant="outline" onclick={saveConfig} disabled={!password || !clientId || !secretKey || busy === "config"}>加密保存验证凭据</Button></Field.FieldGroup></Field.FieldSet>{/if}
		</Field.Group>
		<Dialog.Footer><Button variant="destructive" onclick={() => disableConfirmOpen = true} disabled={!settings?.enabled || busy === "disable"}>关闭 YubiKey</Button><Button onclick={save} disabled={!password || !otps.trim() || busy === "save"}>验证并保存</Button></Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={disableConfirmOpen}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>关闭 YubiKey 两步验证</AlertDialog.Title><AlertDialog.Description>关闭后，已登记的 YubiKey 将不再作为登录第二因素。需要当前主密码才能执行。</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action class="bg-destructive text-destructive-foreground hover:bg-destructive/90" onclick={disable}>确认关闭</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
