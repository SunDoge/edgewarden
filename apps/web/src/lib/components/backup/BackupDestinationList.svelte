<script lang="ts">
import { Plus } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import type { BackupDestinationRecord } from "./types";

let {
	destinations,
	selectedId,
	onAdd,
	onSelect,
}: {
	destinations: BackupDestinationRecord[];
	selectedId: string | null;
	onAdd: () => void;
	onSelect: (id: string) => void;
} = $props();
</script>

<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	<div class="flex items-center justify-between">
		<span class="text-xs font-semibold uppercase tracking-wider text-slate-400">备份目的地</span>
		<Button size="icon" variant="ghost" onclick={onAdd} class="size-7 text-slate-500" title="添加新目的地">
			<Plus class="size-4" />
		</Button>
	</div>
	<div class="space-y-1.5">
		{#each destinations as destination (destination.id)}
			<button
				class="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-all {selectedId === destination.id
					? 'border-primary/20 bg-primary/5 font-medium text-primary'
					: 'border-transparent text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}"
				onclick={() => onSelect(destination.id)}
			>
				<span class="truncate pr-2">{destination.name}</span>
				<span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-800">{destination.type}</span>
			</button>
		{/each}
		{#if destinations.length === 0}
			<p class="py-4 text-center text-xs text-slate-400">未配置备份目的地</p>
		{/if}
	</div>
</div>
