<script lang="ts">
import type { GlobalEquivalentDomain } from "@edgewarden/shared";
import { Input } from "$lib/components/ui/input/index.js";
import { CheckSquare, Search, Square } from "@lucide/svelte";

let {
	rules,
	excludedTypes = $bindable(),
}: {
	rules: GlobalEquivalentDomain[];
	excludedTypes: Set<number>;
} = $props();

let searchQuery = $state("");
let filteredRules = $derived(
	rules.filter((rule) => {
		const query = searchQuery.toLowerCase().trim();
		return !query || rule.domains.some((domain) => domain.includes(query));
	}),
);

function toggle(type: number) {
	const next = new Set(excludedTypes);
	if (next.has(type)) next.delete(type);
	else next.add(type);
	excludedTypes = next;
}
</script>

<section class="flex min-h-[500px] flex-col gap-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
	<div class="flex shrink-0 flex-col justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800 md:flex-row md:items-center">
		<div>
			<h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">全局等效规则</h3>
			<p class="mt-0.5 text-xs text-slate-500">Bitwarden 标准全局等效域名表</p>
		</div>
		<div class="relative w-full md:w-48">
			<Search class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
			<Input type="search" placeholder="搜索全局域名..." bind:value={searchQuery} class="h-[34px] pl-[34px] text-xs" />
		</div>
	</div>

	<div class="max-h-[480px] flex-1 space-y-3 overflow-y-auto pr-1">
		{#each filteredRules as rule}
			{@const excluded = excludedTypes.has(rule.type)}
			<div class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all duration-200 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/30 dark:hover:border-slate-700 {excluded ? 'opacity-50 grayscale-[40%]' : ''}">
				<div class="flex min-w-0 flex-1 items-center gap-3">
					<button onclick={() => toggle(rule.type)} class="shrink-0 text-slate-400 transition-colors hover:text-primary" title={excluded ? "已排除该规则 (点击启用)" : "已包含该规则 (点击排除)"}>
						{#if excluded}<Square class="size-4 text-slate-400" />{:else}<CheckSquare class="size-4 text-primary" />{/if}
					</button>
					<div class="flex min-w-0 flex-1 flex-wrap gap-1.5">
						{#each rule.domains as domain}<span class="select-all rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{domain}</span>{/each}
					</div>
				</div>
				<span class="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold {excluded ? 'border-slate-300 bg-slate-200 text-slate-500 dark:border-slate-700 dark:bg-slate-800' : 'border-primary/20 bg-primary/10 text-primary'}">{excluded ? "已排除" : "已启用"}</span>
			</div>
		{/each}

		{#if filteredRules.length === 0}
			<div class="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/20 p-12 text-slate-400 dark:border-slate-800 dark:bg-slate-900/10">
				<Search class="mb-2 size-8 text-slate-300 dark:text-slate-800" />
				<span class="text-xs">未找到匹配的全局规则</span>
			</div>
		{/if}
	</div>
</section>
