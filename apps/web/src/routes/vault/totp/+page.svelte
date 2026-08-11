<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { Button } from "$lib/components/ui/button/index.js";
	import { calcTotpNow } from "$lib/services/crypto";
	import { syncVaultData, vault } from "$lib/stores/vault.svelte";
	import { ArrowLeft, Check, Copy, KeyRound, RefreshCw } from "@lucide/svelte";

	let codes = $state<Record<string, { code: string; remain: number; period?: number } | null>>({});
	let copiedId = $state<string | null>(null);
	let timer: ReturnType<typeof setInterval> | null = null;
	let items = $derived(vault.ciphers.filter((cipher) => !cipher.deletedDate && cipher.type === 1 && cipher.login?.totp).sort((a, b) => a.name.localeCompare(b.name)));

	async function refreshCodes() {
		const entries = await Promise.all(items.map(async (cipher) => {
			try { return [cipher.id, await calcTotpNow(String(cipher.login?.totp ?? ""))] as const; }
			catch { return [cipher.id, null] as const; }
		}));
		codes = Object.fromEntries(entries);
	}

	async function copyCode(id: string, value: string) {
		await navigator.clipboard.writeText(value);
		copiedId = id;
		setTimeout(() => { if (copiedId === id) copiedId = null; }, 1500);
	}

	onMount(() => {
		void (async () => { if (!vault.ciphers.length) await syncVaultData(); await refreshCodes(); })();
		timer = setInterval(() => void refreshCodes(), 1000);
		return () => { if (timer) clearInterval(timer); };
	});
</script>

<svelte:head><title>验证码 - Edgewarden</title></svelte:head>

<main class="min-h-screen bg-muted/30 p-6">
	<div class="mx-auto max-w-5xl space-y-6">
		<header class="flex items-center gap-3"><Button variant="ghost" size="icon" onclick={() => goto("/vault")} aria-label="返回保险库"><ArrowLeft /></Button><div><h1 class="text-2xl font-bold">验证码</h1><p class="text-sm text-muted-foreground">所有验证码均在本机根据保险库中的 TOTP 密钥计算。</p></div></header>
		{#if vault.isSyncing && !items.length}<div class="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw class="animate-spin" />正在载入…</div>
		{:else if !items.length}<div class="rounded-lg border bg-card p-8 text-center text-muted-foreground"><KeyRound class="mx-auto mb-3 size-8" />没有包含 TOTP 密钥的登录项。</div>
		{:else}<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each items as item (item.id)}
				{@const live = codes[item.id]}
				<div class="rounded-lg border bg-card p-4"><div class="mb-3 min-w-0"><p class="truncate font-semibold">{item.name}</p><p class="truncate text-xs text-muted-foreground">{item.login?.username || "无用户名"}</p></div><div class="flex items-center justify-between gap-3"><div><p class="font-mono text-2xl font-bold tracking-widest">{live ? `${live.code.slice(0, 3)} ${live.code.slice(3)}` : "——— ———"}</p><p class="text-xs text-muted-foreground">{live ? `${live.remain} 秒后刷新` : "无法计算"}</p></div><Button variant="outline" size="icon" disabled={!live} onclick={() => live && copyCode(item.id, live.code)} aria-label={`复制 ${item.name} 的验证码`}>{#if copiedId === item.id}<Check />{:else}<Copy />{/if}</Button></div></div>
			{/each}
		</div>{/if}
	</div>
</main>
