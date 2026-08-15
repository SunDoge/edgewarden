<script lang="ts">
import {
	LogOut,
	Menu,
	MoreVertical,
	RefreshCw,
	ShieldCheck,
	TriangleAlert,
	WifiOff,
} from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
import * as Alert from "$lib/components/ui/alert/index.js";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
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

let syncStatus = $derived.by(() => {
	if (vault.isSyncing) return "正在同步…";
	if (vault.status === "error") return "同步失败";
	if (vault.isOffline)
		return vault.syncedAt
			? m.vault_cached_at({ time: formatTime(vault.syncedAt) })
			: m.vault_offline_cache();
	return vault.syncedAt
		? m.vault_synced_at({ time: formatTime(vault.syncedAt) })
		: "等待首次同步";
});
</script>

<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-2 sm:px-4 md:px-6">
	<div class="flex items-center gap-2.5">
		<Button variant="ghost" size="icon" class="md:hidden" onclick={onOpenNavigation} aria-label={m.vault_open_navigation()}><Menu /></Button>
		<div class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck class="size-5" /></div>
		<div class="min-w-0"><span class="hidden text-lg font-bold sm:block">Edgewarden</span><span class="block max-w-32 truncate text-xs text-muted-foreground sm:hidden">{syncStatus}</span></div>
		{#if vault.isOffline}
			<Badge class="hidden md:inline-flex" variant="secondary"><WifiOff data-icon="inline-start" />{m.vault_offline_cache()}</Badge>
		{:else}
			<Badge class="hidden md:inline-flex">{m.vault_zero_knowledge_protected()}</Badge>
		{/if}
	</div>
	<div class="flex items-center gap-2">
		<span class="hidden text-xs text-muted-foreground sm:block">{syncStatus}</span>
		<Button variant="ghost" size="sm" onclick={() => syncVaultData()} disabled={vault.isSyncing} aria-label={m.vault_sync()}>{#if vault.isSyncing}<Spinner />{:else}<RefreshCw />{/if}</Button>
		<ThemeToggle />
		<Button variant="ghost" size="sm" onclick={onLogout} class="hidden text-muted-foreground sm:inline-flex" aria-label={m.vault_lock_and_logout()}><LogOut /><span>{m.vault_lock_and_logout()}</span></Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}<Button {...props} variant="ghost" size="icon" class="sm:hidden" aria-label="更多操作"><MoreVertical /></Button>{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Group>
					<DropdownMenu.Item onclick={() => syncVaultData()} disabled={vault.isSyncing}><RefreshCw />立即同步</DropdownMenu.Item>
					<DropdownMenu.Item onclick={onLogout} variant="destructive"><LogOut />{m.vault_lock_and_logout()}</DropdownMenu.Item>
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
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
