<script lang="ts">
import { AlertCircle, Check, RefreshCw, Server } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { formatFileSize } from "$lib/services/backup-display";
import type { BackupDestinationRecord } from "./types";

let {
	destination,
	currentPath,
	running,
	browsing,
	onRun,
	onOpenParent,
}: {
	destination: BackupDestinationRecord | undefined;
	currentPath: string;
	running: boolean;
	browsing: boolean;
	onRun: () => void;
	onOpenParent: () => void;
} = $props();
</script>

<div class="space-y-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
	<div class="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
		<div><h2 class="text-base font-bold text-slate-900 dark:text-slate-50">备份任务状态</h2><p class="text-xs text-slate-500">查看最后一次备份触发运行的结果和时间</p></div>
		<Button size="sm" onclick={onRun} disabled={running} class="gap-1.5 bg-primary text-white hover:bg-primary/95">
			{#if running}<RefreshCw class="size-3.5 animate-spin" />正在备份上传...{:else}<Server class="size-3.5" />立即执行备份{/if}
		</Button>
	</div>
	<div class="flex items-center gap-2 text-xs"><Button variant="outline" size="sm" onclick={onOpenParent} disabled={!currentPath || browsing}>上一级</Button><code class="rounded bg-muted px-2 py-1">/{currentPath}</code></div>
	<div class="grid grid-cols-1 gap-x-6 gap-y-3.5 text-sm md:grid-cols-2">
		<div class="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800/50"><span class="text-slate-500">上次运行时间：</span><span class="font-medium text-slate-900 dark:text-slate-100">{destination?.runtime.lastAttemptAt ? new Date(destination.runtime.lastAttemptAt).toLocaleString("zh-CN") : "从未运行"}</span></div>
		<div class="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800/50"><span class="text-slate-500">上次成功备份时间：</span><span class="font-medium text-emerald-600 dark:text-emerald-400">{destination?.runtime.lastSuccessAt ? new Date(destination.runtime.lastSuccessAt).toLocaleString("zh-CN") : "从未成功"}</span></div>
		<div class="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800/50 md:col-span-2"><span class="font-medium text-slate-500">上次生成的文件名：</span><span class="font-mono text-xs text-slate-800 dark:text-slate-200">{destination?.runtime.lastUploadedFileName || "--"}</span></div>
		<div class="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800/50"><span class="text-slate-500">备份文件大小：</span><span class="font-medium text-slate-900 dark:text-slate-100">{formatFileSize(destination?.runtime.lastUploadedSizeBytes)}</span></div>
		<div class="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800/50">
			<span class="font-medium text-slate-500">运行状态结果：</span>
			{#if destination?.runtime.lastErrorAt}<span class="flex select-all items-center gap-1 text-xs font-semibold text-red-500"><AlertCircle class="size-3.5 shrink-0" />错误：{destination.runtime.lastErrorMessage}</span>{:else if destination?.runtime.lastSuccessAt}<span class="flex items-center gap-0.5 text-xs font-semibold text-emerald-500"><Check class="size-3.5" />正常</span>{:else}<span class="text-xs font-medium text-slate-400">无状态信息</span>{/if}
		</div>
	</div>
</div>
