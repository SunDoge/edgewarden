<script lang="ts">
import { Download, RefreshCw } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";

let {
	file = $bindable(),
	replaceExisting = $bindable(),
	allowChecksumMismatch = $bindable(),
	restoring,
	onExport,
	onImport,
}: {
	file: File | null;
	replaceExisting: boolean;
	allowChecksumMismatch: boolean;
	restoring: boolean;
	onExport: () => void;
	onImport: () => void;
} = $props();
</script>

<div class="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	<span class="block text-xs font-semibold uppercase tracking-wider text-slate-400">手动备份与恢复</span>
	<Button variant="outline" size="sm" onclick={onExport} class="w-full gap-2">
		<Download class="size-3.5" />导出本地备份 (.zip)
	</Button>
	<hr class="border-slate-100 dark:border-slate-800" />
	<div class="space-y-2">
		<span class="block text-xs font-medium text-slate-700 dark:text-slate-300">从本地文件恢复</span>
		<input
			type="file"
			accept=".zip"
			class="block w-full rounded border p-1 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950"
			onchange={(event) => (file = event.currentTarget.files?.[0] ?? null)}
		/>
		<div class="mt-2 flex items-center gap-4">
			<label class="flex cursor-pointer items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
				<input type="checkbox" bind:checked={replaceExisting} class="rounded" />替换现有数据
			</label>
			<label class="flex cursor-pointer items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
				<input type="checkbox" bind:checked={allowChecksumMismatch} class="rounded" />忽略校验和错误
			</label>
		</div>
		<Button variant="outline" size="sm" onclick={onImport} disabled={!file || restoring} class="mt-1.5 w-full">
			{#if restoring}<RefreshCw class="mr-1.5 size-3.5 animate-spin" />正在导入...{:else}导入并应用{/if}
		</Button>
	</div>
</div>
