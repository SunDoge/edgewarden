<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Empty from "$lib/components/ui/empty/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
import TotpCountdown from "$lib/components/vault/TotpCountdown.svelte";
import { calcTotpNow } from "$lib/services/crypto";
import { vault } from "$lib/stores/vault.svelte";
import { ArrowLeft, Check, Copy, KeyRound } from "@lucide/svelte";

let codes = $state<
	Record<string, { code: string; remain: number; period: number } | null>
>({});
let copiedId = $state<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
let items = $derived(
	vault.ciphers
		.filter(
			(cipher) =>
				!cipher.deletedDate && cipher.type === 1 && cipher.login?.totp,
		)
		.sort((a, b) => a.name.localeCompare(b.name)),
);

async function refreshCodes() {
	const entries = await Promise.all(
		items.map(async (cipher) => {
			try {
				return [
					cipher.id,
					await calcTotpNow(String(cipher.login?.totp ?? "")),
				] as const;
			} catch {
				return [cipher.id, null] as const;
			}
		}),
	);
	codes = Object.fromEntries(entries);
}

async function copyCode(id: string, value: string) {
	await navigator.clipboard.writeText(value);
	copiedId = id;
	setTimeout(() => {
		if (copiedId === id) copiedId = null;
	}, 1500);
}

onMount(() => {
	void refreshCodes();
	timer = setInterval(() => void refreshCodes(), 1000);
	return () => {
		if (timer) clearInterval(timer);
	};
});
</script>

<svelte:head><title>验证码 - Edgewarden</title></svelte:head>

<VaultPageShell title="验证码" description="所有验证码均在本机根据保险库中的 TOTP 密钥计算。" width="default">
		{#if vault.isSyncing && !items.length}<Empty.Root><Empty.Media variant="icon"><Spinner /></Empty.Media><Empty.Header><Empty.Title>正在载入验证码</Empty.Title></Empty.Header></Empty.Root>
		{:else if !items.length}<Empty.Root><Empty.Media variant="icon"><KeyRound /></Empty.Media><Empty.Header><Empty.Title>没有包含 TOTP 密钥的登录项</Empty.Title><Empty.Description>为登录项目添加 TOTP 密钥后，验证码会显示在这里。</Empty.Description></Empty.Header></Empty.Root>
		{:else}<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each items as item (item.id)}
				{@const live = codes[item.id]}
				<Card.Root><Card.Header class="pb-3"><Card.Title class="truncate">{item.name}</Card.Title><Card.Description class="truncate">{item.login?.username || "无用户名"}</Card.Description></Card.Header><Card.Content><div class="flex items-center justify-between gap-3"><div><p class="font-mono text-2xl font-bold tracking-widest">{live ? `${live.code.slice(0, 3)} ${live.code.slice(3)}` : "——— ———"}</p><p class="text-xs text-muted-foreground">{live ? "动态验证码" : "无法计算"}</p></div><div class="flex items-center gap-2">{#if live}<TotpCountdown remain={live.remain} period={live.period} />{/if}<Button variant="outline" size="icon" disabled={!live} onclick={() => live && copyCode(item.id, live.code)} aria-label={`复制 ${item.name} 的验证码`}>{#if copiedId === item.id}<Check />{:else}<Copy />{/if}</Button></div></div></Card.Content></Card.Root>
			{/each}
		</div>{/if}
</VaultPageShell>
