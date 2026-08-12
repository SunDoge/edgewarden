<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { isLoggedIn } from "$lib/services/api";
import { vault } from "$lib/stores/vault.svelte";
import { fetchDomainRules, updateDomainRules } from "$lib/services/api";
import { Button } from "$lib/components/ui/button/index.js";
import CustomEquivalentDomains from "$lib/components/domains/CustomEquivalentDomains.svelte";
import { normalizeEquivalentDomainRule } from "$lib/services/equivalent-domains";
import GlobalEquivalentDomains from "$lib/components/domains/GlobalEquivalentDomains.svelte";
import {
	ArrowLeft,
	Save,
	Globe,
	ShieldCheck,
	RefreshCw,
	AlertCircle,
	Info,
} from "@lucide/svelte";
import type {
	CustomEquivalentDomain,
	GlobalEquivalentDomain,
} from "@edgewarden/shared";

// Page state
let loading = $state(true);
let saving = $state(false);
let error = $state("");
let successMsg = $state("");

// Domain rules data
let customRules = $state<CustomEquivalentDomain[]>([]);
let globalRules = $state<GlobalEquivalentDomain[]>([]);
let excludedTypes = $state<Set<number>>(new Set());


onMount(async () => {
	if (!isLoggedIn()) {
		goto("/login");
		return;
	}
	if (!vault.isUnlocked) {
		goto("/vault/unlock");
		return;
	}
	await loadRules();
});

async function loadRules() {
	loading = true;
	error = "";
	try {
		const res = await fetchDomainRules();
		// Convert to mutable state arrays
		customRules = res.customEquivalentDomains.map((r) => ({
			id: r.id,
			domains: [...r.domains],
			excluded: !!r.excluded,
		}));
		globalRules = res.globalEquivalentDomains.map((g) => ({
			type: g.type,
			domains: [...g.domains],
			excluded: !!g.excluded,
		}));
		excludedTypes = new Set(
			res.globalEquivalentDomains.filter((g) => g.excluded).map((g) => g.type),
		);
	} catch (e: any) {
		error = e.message || "加载域名规则失败，请稍后重试。";
	} finally {
		loading = false;
	}
}

// Save & Sync
async function handleSave() {
	saving = true;
	error = "";
	successMsg = "";
	try {
		// Clean rules first
		const payloadRules = customRules
			.map((r) => ({
				...r,
				domains: normalizeEquivalentDomainRule(r.domains).domains,
			}))
			.filter((r) => r.domains.length >= 2);

		const excludedList = Array.from(excludedTypes);

		const updated = await updateDomainRules(payloadRules, excludedList);

		// Sync local store state too
		customRules = updated.customEquivalentDomains.map((r) => ({
			id: r.id,
			domains: [...r.domains],
			excluded: !!r.excluded,
		}));
		excludedTypes = new Set(
			updated.globalEquivalentDomains
				.filter((g) => g.excluded)
				.map((g) => g.type),
		);

		showTimedSuccess("等效域名规则已成功保存并应用！");
	} catch (e: any) {
		error = e.message || "保存规则失败，请稍后重试。";
	} finally {
		saving = false;
	}
}

// Helpers for notifications
let notificationTimeout: any;
function showTimedSuccess(msg: string) {
	successMsg = msg;
	error = "";
	if (notificationTimeout) clearTimeout(notificationTimeout);
	notificationTimeout = setTimeout(() => {
		successMsg = "";
	}, 4000);
}

function showTimedError(msg: string) {
	error = msg;
	successMsg = "";
	if (notificationTimeout) clearTimeout(notificationTimeout);
	notificationTimeout = setTimeout(() => {
		error = "";
	}, 4000);
}
</script>

<svelte:head>
	<title>域名等效规则 - Edgewarden</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
	<!-- Navbar Header -->
	<header class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 sm:h-14 sm:flex-nowrap sm:px-6 sm:py-0">
		<div class="flex items-center gap-3">
			<Button variant="ghost" size="icon" onclick={() => goto("/vault")} class="size-9 rounded-lg">
				<ArrowLeft class="size-4" />
			</Button>
			<div class="flex items-center gap-2">
				<Globe class="size-5 text-primary" />
				<h1 class="font-bold text-base text-slate-800 dark:text-slate-100">域名等效规则</h1>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				onclick={loadRules}
				disabled={loading || saving}
				class="gap-1.5 h-9"
			>
				<RefreshCw class="size-3.5 {loading ? 'animate-spin' : ''}" />
				<span class="hidden sm:inline">同步刷新</span>
			</Button>
			<Button
				onclick={handleSave}
				disabled={loading || saving}
				class="gap-1.5 h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
			>
				<Save class="size-3.5" />
				{saving ? "保存中..." : "保存"}<span class="hidden sm:inline">并应用</span>
			</Button>
		</div>
	</header>

	<main class="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-6 overflow-y-auto p-3 sm:p-6 md:p-8">
		<!-- Notification Alerts -->
		{#if error}
			<div class="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-400 flex gap-3 items-start animate-in fade-in slide-in-from-top-2 duration-200">
				<AlertCircle class="size-5 shrink-0 mt-0.5" />
				<div>
					<p class="text-sm font-semibold">操作提示</p>
					<p class="text-xs mt-0.5 leading-relaxed">{error}</p>
				</div>
			</div>
		{/if}

		{#if successMsg}
			<div class="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-400 flex gap-3 items-start animate-in fade-in slide-in-from-top-2 duration-200">
				<ShieldCheck class="size-5 shrink-0 mt-0.5" />
				<div>
					<p class="text-sm font-semibold">成功</p>
					<p class="text-xs mt-0.5 leading-relaxed">{successMsg}</p>
				</div>
			</div>
		{/if}

		<!-- Intro Description Card -->
		<div class="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
			<div class="space-y-1">
				<h2 class="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
					<Info class="size-4 text-slate-400" />
					关于域名等效规则
				</h2>
				<p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-3xl">
					等效规则允许将不同的域名或主机名组合在一起。
					当您登录属于同一规则下的任何域名时，Edgewarden 会认为它们是等效的，并自动推荐您的账户凭据。
					例如，将 <code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[10px] text-primary">apple.com</code> 和 <code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[10px] text-primary">icloud.com</code> 设为等效。
				</p>
			</div>
		</div>

		{#if loading}
			<!-- Skeleton Loader -->
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{#each Array(2) as _}
					<div class="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm animate-pulse">
						<div class="h-6 w-40 bg-slate-200 dark:bg-slate-800 rounded"></div>
						<div class="space-y-3">
							<div class="h-10 bg-slate-100 dark:bg-slate-850 rounded"></div>
							<div class="h-10 bg-slate-100 dark:bg-slate-850 rounded"></div>
							<div class="h-10 bg-slate-100 dark:bg-slate-850 rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
				
				<CustomEquivalentDomains bind:rules={customRules} onSuccess={showTimedSuccess} onError={showTimedError} />

				<GlobalEquivalentDomains rules={globalRules} bind:excludedTypes />
				
			</div>
		{/if}
	</main>
</div>
