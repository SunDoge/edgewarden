<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { Button } from "$lib/components/ui/button/index.js";
	import { inspectPasswordHealth, type PasswordHealthReport } from "$lib/services/password-health";
	import { syncVaultData, vault } from "$lib/stores/vault.svelte";
	import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, RefreshCw, ShieldAlert } from "@lucide/svelte";

	let report = $state<PasswordHealthReport | null>(null);
	let scanning = $state(false);
	let scanError = $state<string | null>(null);
	let controller: AbortController | null = null;
	let filter = $state<"all" | "exposed" | "reused" | "weak">("all");
	let progress = $state({ checked: 0, total: 0 });
	let revealed = $state<Set<string>>(new Set());
	let filteredItems = $derived(report?.items.filter((item) => filter === "all" || (filter === "exposed" && (item.exposedCount ?? 0) > 0) || (filter === "reused" && item.reusedCount > 1) || (filter === "weak" && item.weak)) ?? []);

	async function scan() {
		controller?.abort();
		controller = new AbortController();
		scanning = true;
		filter = "all";
		revealed = new Set();
		progress = { checked: 0, total: vault.ciphers.filter((cipher) => cipher.type === 1 && !cipher.deletedDate && !(cipher as any).hidePasswords && cipher.login?.password).length };
		scanError = null;
		try { report = await inspectPasswordHealth(vault.ciphers, fetch, controller.signal, (checked, total) => progress = { checked, total }); }
		catch (error) { if (!controller.signal.aborted) scanError = error instanceof Error ? error.message : String(error); }
		finally { scanning = false; }
	}

	onMount(() => {
		void (async () => { if (!vault.ciphers.length) await syncVaultData(); })();
		return () => controller?.abort();
	});

	function toggleReveal(id: string) {
		const next = new Set(revealed);
		if (next.has(id)) next.delete(id); else next.add(id);
		revealed = next;
	}
</script>

<svelte:head><title>密码健康 - Edgewarden</title></svelte:head>

<main class="min-h-screen bg-muted/30 p-6"><div class="mx-auto max-w-5xl space-y-6">
	<header class="flex items-center justify-between gap-3"><div class="flex items-center gap-3"><Button variant="ghost" size="icon" onclick={() => goto("/vault")} aria-label="返回保险库"><ArrowLeft /></Button><div><h1 class="text-2xl font-bold">密码健康</h1><p class="text-sm text-muted-foreground">只向 Have I Been Pwned 发送 SHA-1 摘要前 5 位；密码和完整摘要不会离开浏览器。</p></div></div><Button onclick={scan} disabled={scanning || vault.isSyncing}>{#if scanning}<RefreshCw class="animate-spin" />{:else}<ShieldAlert />{/if}{report ? "重新检查" : "开始检查"}</Button></header>
	{#if scanError}<div class="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{scanError}</div>{/if}
	{#if scanning}<div class="rounded-lg border bg-card p-4 text-sm text-muted-foreground">正在检查 {progress.checked} / {progress.total}</div>{/if}
	{#if report}<div class="grid gap-3 sm:grid-cols-4">
		<button class="rounded-lg border bg-card p-4 text-left {filter === 'exposed' ? 'ring-2 ring-primary' : ''}" onclick={() => filter = "exposed"}><p class="text-2xl font-bold text-destructive">{report.exposedCount}</p><p class="text-xs text-muted-foreground">已泄露</p></button>
		<button class="rounded-lg border bg-card p-4 text-left {filter === 'reused' ? 'ring-2 ring-primary' : ''}" onclick={() => filter = "reused"}><p class="text-2xl font-bold text-amber-600">{report.reusedCount}</p><p class="text-xs text-muted-foreground">重复使用</p></button>
		<button class="rounded-lg border bg-card p-4 text-left {filter === 'weak' ? 'ring-2 ring-primary' : ''}" onclick={() => filter = "weak"}><p class="text-2xl font-bold text-amber-600">{report.weakCount}</p><p class="text-xs text-muted-foreground">弱密码</p></button>
		<button class="rounded-lg border bg-card p-4 text-left {filter === 'all' ? 'ring-2 ring-primary' : ''}" onclick={() => filter = "all"}><p class="text-2xl font-bold">{report.eligibleCount}</p><p class="text-xs text-muted-foreground">已检查</p></button>
	</div><div class="space-y-2">{#each filteredItems as risk (risk.cipherId)}{@const cipher = vault.ciphers.find((item) => item.id === risk.cipherId)}<div class="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left"><button class="min-w-0 flex-1 text-left" onclick={() => goto(`/vault?cipher=${encodeURIComponent(risk.cipherId)}`)}><p class="truncate font-semibold">{cipher?.name ?? "未知条目"}</p><p class="truncate text-xs text-muted-foreground">{cipher?.login?.username ?? ""}</p><p class="mt-1 font-mono text-xs">{revealed.has(risk.cipherId) ? cipher?.login?.password : "••••••••••••"}</p></button><Button variant="ghost" size="icon-sm" onclick={() => toggleReveal(risk.cipherId)} aria-label="显示或隐藏密码">{#if revealed.has(risk.cipherId)}<EyeOff />{:else}<Eye />{/if}</Button><div class="flex flex-wrap justify-end gap-1 text-xs">{#if risk.exposedCount === null}<span class="rounded bg-muted px-2 py-1">查询不可用</span>{:else if risk.exposedCount > 0}<span class="rounded bg-destructive/10 px-2 py-1 text-destructive">泄露 {risk.exposedCount} 次</span>{/if}{#if risk.reusedCount > 1}<span class="rounded bg-amber-100 px-2 py-1 text-amber-800">重复 {risk.reusedCount} 项</span>{/if}{#if risk.weak}<span class="rounded bg-amber-100 px-2 py-1 text-amber-800">弱密码</span>{/if}</div></div>{/each}{#if !filteredItems.length}<div class="rounded-lg border bg-card p-8 text-center text-muted-foreground"><CheckCircle2 class="mx-auto mb-2 text-emerald-600" />当前筛选下未发现密码风险。</div>{/if}</div>
	{:else if !scanning}<div class="rounded-lg border bg-card p-8 text-center text-muted-foreground"><AlertTriangle class="mx-auto mb-3" />检查会在浏览器中计算摘要，并使用 k-anonymity 查询泄露次数。</div>{/if}
</div></main>
