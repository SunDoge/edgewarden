<script lang="ts">
import { ShieldCheck, Trash2 } from "@lucide/svelte";
import { onMount } from "svelte";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
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
} from "$lib/services/passkeys";
import { vault } from "$lib/stores/vault.svelte";

interface AccountPasskey {
	id: string;
	name?: string | null;
	creationDate?: string | null;
	prfStatus: number;
}

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
		const options = await getAccountPasskeyAttestationOptionsApi(
			await passwordHash(password),
		);
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
				if (
					!confirm(
						"无法为这把通行密钥启用保险库直接解锁。仍保存为仅登录通行密钥？",
					)
				)
					throw error;
			}
		}
		await createAccountPasskeyApi({
			token: pending.token,
			deviceResponse: pending.request,
			name: name.trim() || undefined,
			supportsPrf: pending.supportsPrf && !!keySet.encryptedUserKey,
			...keySet,
		});
		await load();
		createOpen = false;
		name = "";
		password = "";
		onMessage("通行密钥已添加");
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
		await deleteAccountPasskeyApi(
			deletePasskey.id,
			await passwordHash(deletePassword),
		);
		passkeys = passkeys.filter((item) => item.id !== deletePasskey?.id);
		deletePasskey = null;
		deletePassword = "";
		onMessage("通行密钥已删除");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}

async function enableDirectUnlock() {
	if (!enablePasskey || !enablePassword || !vault.symEncKey || !vault.symMacKey)
		return;
	busy = "enable";
	try {
		const assertion = await assertAccountPasskey(
			await getAccountPasskeyAssertionOptionsApi(
				await passwordHash(enablePassword),
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
		await load();
		enablePasskey = null;
		enablePassword = "";
		onMessage("已启用通行密钥直接解锁");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}
</script>

<Card.Root>
	<Card.Header class="flex-row items-start justify-between"><div><Card.Title>通行密钥</Card.Title><Card.Description>最多添加 5 把 WebAuthn 通行密钥；支持 PRF 的设备可直接解锁保险库。</Card.Description></div><Button size="sm" onclick={() => createOpen = true} disabled={passkeys.length >= 5}>添加</Button></Card.Header>
	<Card.Content class="flex flex-col gap-2">
		{#each passkeys as passkey (passkey.id)}
			<div class="flex items-center justify-between gap-3 rounded-md border p-3"><div><div class="font-medium">{passkey.name || "通行密钥"}</div><div class="text-xs text-muted-foreground">{passkey.creationDate ? new Date(passkey.creationDate).toLocaleString() : ""}</div></div><div class="flex items-center gap-2"><Badge variant={passkey.prfStatus === 0 ? "default" : "secondary"}>{passkey.prfStatus === 0 ? "可直接解锁" : passkey.prfStatus === 1 ? "可启用直接解锁" : "仅登录"}</Badge>{#if passkey.prfStatus === 1}<Button variant="outline" size="sm" onclick={() => enablePasskey = passkey}><ShieldCheck />启用直接解锁</Button>{/if}<Button variant="ghost" size="icon-sm" onclick={() => deletePasskey = passkey} aria-label="删除通行密钥"><Trash2 /></Button></div></div>
		{:else}<p class="py-4 text-sm text-muted-foreground">尚未添加通行密钥。</p>{/each}
	</Card.Content>
</Card.Root>

<Dialog.Root bind:open={createOpen}><Dialog.Content><Dialog.Header><Dialog.Title>添加通行密钥</Dialog.Title><Dialog.Description>需要当前主密码验证身份，随后浏览器会打开 WebAuthn 提示。</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label for="passkey-name">名称</Field.Label><Input id="passkey-name" bind:value={name} placeholder="例如：MacBook Touch ID" /></Field.Field><Field.Field><Field.Label for="passkey-password">当前主密码</Field.Label><Input id="passkey-password" type="password" bind:value={password} autocomplete="current-password" /></Field.Field></Field.Group><Dialog.Footer><Button variant="outline" onclick={() => createOpen = false}>取消</Button><Button onclick={createPasskey} disabled={!password || busy === "create"}>创建通行密钥</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root open={!!enablePasskey} onOpenChange={(open) => { if (!open) enablePasskey = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>启用直接解锁</Dialog.Title><Dialog.Description>验证主密码和这把通行密钥后，浏览器会使用 PRF 输出保护保险库密钥。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="enable-passkey-password">当前主密码</Field.Label><Input id="enable-passkey-password" type="password" bind:value={enablePassword} autocomplete="current-password" /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => enablePasskey = null}>取消</Button><Button onclick={enableDirectUnlock} disabled={!enablePassword || busy === "enable"}>启用</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root open={!!deletePasskey} onOpenChange={(open) => { if (!open) deletePasskey = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>删除通行密钥</Dialog.Title><Dialog.Description>请输入当前主密码确认删除“{deletePasskey?.name || "通行密钥"}”。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="delete-passkey-password">当前主密码</Field.Label><Input id="delete-passkey-password" type="password" bind:value={deletePassword} autocomplete="current-password" /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => deletePasskey = null}>取消</Button><Button variant="destructive" onclick={removePasskey} disabled={!deletePassword || busy === "delete"}>删除</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
