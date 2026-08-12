<script lang="ts">
import { Fingerprint, Trash2 } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import {
	createTwoFactorPasskeyApi,
	deleteTwoFactorPasskeyApi,
	getTwoFactorPasskeyChallengeApi,
	getTwoFactorPasskeysApi,
} from "$lib/services/api";
import {
	deriveMasterKey,
	deriveMasterPasswordHash,
} from "$lib/services/crypto";
import { createTwoFactorPasskeyCredential } from "$lib/services/passkeys";

interface TwoFactorPasskey {
	id: string | number;
	name?: string | null;
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

let open = $state(false);
let busy = $state("");
let password = $state("");
let name = $state("");
let credentials = $state<TwoFactorPasskey[]>([]);

async function passwordHash(): Promise<string> {
	const key = await deriveMasterKey(password, email, kdfIterations);
	return deriveMasterPasswordHash(key, password);
}

async function load() {
	if (!password) return;
	busy = "load";
	try {
		const result = await getTwoFactorPasskeysApi(await passwordHash());
		credentials = result.keys ?? result.Keys ?? [];
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}

async function add() {
	if (!password) return;
	busy = "create";
	try {
		const masterPasswordHash = await passwordHash();
		const credential = await createTwoFactorPasskeyCredential(
			await getTwoFactorPasskeyChallengeApi(masterPasswordHash),
		);
		const result = await createTwoFactorPasskeyApi({
			masterPasswordHash,
			name: name.trim() || "安全密钥",
			...credential,
		});
		credentials = result.keys ?? result.Keys ?? [];
		name = "";
		onMessage("两步验证安全密钥已添加");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}

async function remove(id: string) {
	if (!password || !confirm("删除这把两步验证安全密钥？")) return;
	busy = `delete-${id}`;
	try {
		const result = await deleteTwoFactorPasskeyApi({
			id,
			masterPasswordHash: await passwordHash(),
		});
		credentials = result.keys ?? result.Keys ?? [];
		onMessage("两步验证安全密钥已删除");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}
</script>

<Card.Root>
	<Card.Header><Card.Title>两步验证安全密钥</Card.Title><Card.Description>这些凭据只作为第二因素，不能单独登录或解锁保险库。</Card.Description></Card.Header>
	<Card.Content><Button variant="outline" onclick={() => open = true}><Fingerprint />管理安全密钥</Button></Card.Content>
</Card.Root>

<Dialog.Root bind:open><Dialog.Content><Dialog.Header><Dialog.Title>两步验证安全密钥</Dialog.Title><Dialog.Description>先用主密码验证身份，再添加或删除安全密钥。</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label for="two-factor-passkey-password">当前主密码</Field.Label><Input id="two-factor-passkey-password" type="password" bind:value={password} autocomplete="current-password" /></Field.Field><Field.Field orientation="horizontal"><Button variant="outline" onclick={load} disabled={!password || busy === "load"}>读取设置</Button></Field.Field>{#if credentials.length}<div class="space-y-2">{#each credentials as credential (credential.id)}<div class="flex items-center justify-between rounded-md border p-3"><span>{credential.name || "安全密钥"}</span><Button variant="ghost" size="icon-sm" onclick={() => remove(String(credential.id))} disabled={busy === `delete-${credential.id}`} aria-label="删除安全密钥"><Trash2 /></Button></div>{/each}</div>{/if}<Field.Field><Field.Label for="two-factor-passkey-name">新安全密钥名称</Field.Label><Input id="two-factor-passkey-name" bind:value={name} placeholder="例如：USB 安全密钥" /></Field.Field></Field.Group><Dialog.Footer><Button variant="outline" onclick={() => open = false}>关闭</Button><Button onclick={add} disabled={!password || busy === "create"}><Fingerprint />添加安全密钥</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
