<script lang="ts">
import {
	LogOut,
	Menu,
	RefreshCw,
	ShieldCheck,
	WifiOff,
} from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { formatVaultSyncTime } from "$lib/services/vault-item-display";
import { syncVaultData, vault } from "$lib/stores/vault.svelte";

let {
	onOpenNavigation,
	onLogout,
}: {
	onOpenNavigation: () => void;
	onLogout: () => void | Promise<void>;
} = $props();
</script>

<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-2 sm:px-4 md:px-6">
	<div class="flex items-center gap-2.5">
		<Button variant="ghost" size="icon" class="md:hidden" onclick={onOpenNavigation} aria-label="打开保险库导航"><Menu /></Button>
		<div class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck class="size-5" /></div>
		<span class="hidden text-lg font-bold sm:inline">Edgewarden</span>
		{#if vault.isOffline}
			<span class="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400"><WifiOff class="size-3" />离线缓存</span>
		{:else}
			<span class="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">零知识加密保护中</span>
		{/if}
	</div>
	<div class="flex items-center gap-2">
		{#if vault.syncedAt}<span class="hidden text-xs text-slate-400 sm:block">{vault.isOffline ? "缓存于" : "同步于"} {formatVaultSyncTime(vault.syncedAt)}</span>{/if}
		<Button variant="ghost" size="sm" onclick={() => syncVaultData()} disabled={vault.isSyncing} class="text-slate-500" aria-label="同步保险库"><RefreshCw class="size-4 {vault.isSyncing ? 'animate-spin' : ''}" /></Button>
		<Button variant="ghost" size="sm" onclick={onLogout} class="text-muted-foreground" aria-label="锁定并退出"><LogOut /><span class="hidden sm:inline">锁定并退出</span></Button>
	</div>
</header>

{#if vault.warning}<div class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{vault.warning}</div>{/if}
