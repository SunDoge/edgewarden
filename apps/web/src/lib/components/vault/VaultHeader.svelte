<script lang="ts">
import {
	LogOut,
	Menu,
	RefreshCw,
	ShieldCheck,
	TriangleAlert,
	WifiOff,
} from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as Alert from "$lib/components/ui/alert/index.js";
import { formatTime } from "$lib/i18n/format";
import { m } from "$lib/paraglide/messages.js";
import { syncVaultData, vault } from "$lib/stores/vault.svelte";
import ThemeToggle from "$lib/components/theme-toggle.svelte";

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
		<Button variant="ghost" size="icon" class="md:hidden" onclick={onOpenNavigation} aria-label={m.vault_open_navigation()}><Menu /></Button>
		<div class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck class="size-5" /></div>
		<span class="hidden text-lg font-bold sm:inline">Edgewarden</span>
		{#if vault.isOffline}
			<span class="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400"><WifiOff class="size-3" />{m.vault_offline_cache()}</span>
		{:else}
			<span class="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">{m.vault_zero_knowledge_protected()}</span>
		{/if}
	</div>
	<div class="flex items-center gap-2">
		{#if vault.syncedAt}<span class="hidden text-xs text-slate-400 sm:block">{vault.isOffline ? m.vault_cached_at({ time: formatTime(vault.syncedAt) }) : m.vault_synced_at({ time: formatTime(vault.syncedAt) })}</span>{/if}
		<Button variant="ghost" size="sm" onclick={() => syncVaultData()} disabled={vault.isSyncing} class="text-slate-500" aria-label={m.vault_sync()}><RefreshCw class="size-4 {vault.isSyncing ? 'animate-spin' : ''}" /></Button>
		<ThemeToggle />
		<Button variant="ghost" size="sm" onclick={onLogout} class="text-muted-foreground" aria-label={m.vault_lock_and_logout()}><LogOut /><span class="hidden sm:inline">{m.vault_lock_and_logout()}</span></Button>
	</div>
</header>

{#if vault.warning}
	<div class="border-b bg-muted/30 p-2 sm:px-4">
		<Alert.Root>
			<TriangleAlert />
			<Alert.Title>{m.vault_sync_warning_title()}</Alert.Title>
			<Alert.Description>{vault.warning}</Alert.Description>
		</Alert.Root>
	</div>
{/if}
