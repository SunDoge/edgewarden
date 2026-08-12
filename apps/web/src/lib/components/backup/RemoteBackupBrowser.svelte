<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { formatFileSize } from "$lib/services/backup-display";
	import {
		Download,
		FileArchive,
		Folder,
		Info,
		RefreshCw,
		ShieldCheck,
		Trash2,
	} from "@lucide/svelte";

	export interface RemoteBackupItem {
		name: string;
		path: string;
		isDirectory: boolean;
		size: number | null;
		modifiedAt: string | null;
	}

	let {
		items,
		browsing,
		downloading,
		deleting,
		inspecting,
		restoring,
		onRefresh,
		onOpenDirectory,
		onInspect,
		onDownload,
		onRestore,
		onDelete,
	}: {
		items: RemoteBackupItem[];
		browsing: boolean;
		downloading: string | null;
		deleting: string | null;
		inspecting: string | null;
		restoring: boolean;
		onRefresh: () => void;
		onOpenDirectory: (path: string) => void;
		onInspect: (path: string) => void;
		onDownload: (path: string, name: string) => void;
		onRestore: (path: string) => void;
		onDelete: (path: string) => void;
	} = $props();
</script>

<div class="space-y-4 rounded-xl border bg-card p-6 text-card-foreground">
	<div class="flex items-center justify-between border-b pb-3">
		<div>
			<h2 class="text-base font-bold">存储服务器备份浏览器</h2>
			<p class="text-xs text-muted-foreground">浏览远端归档，可直接还原或清理历史记录</p>
		</div>
		<Button size="sm" variant="outline" onclick={onRefresh} disabled={browsing} class="size-8" aria-label="刷新远端备份">
			<RefreshCw class={browsing ? "size-4 animate-spin" : "size-4"} />
		</Button>
	</div>

	<div class="overflow-x-auto">
		<table class="w-full border-collapse text-left text-sm">
			<thead><tr class="border-b text-xs font-semibold uppercase text-muted-foreground"><th class="px-3 py-2.5">文件名</th><th class="px-3 py-2.5">文件大小</th><th class="px-3 py-2.5">上次修改时间</th><th class="px-3 py-2.5 text-right">操作</th></tr></thead>
			<tbody class="divide-y">
				{#each items as item (item.path)}
					<tr class="hover:bg-muted/50">
						<td class="px-3 py-3 font-mono text-xs"><div class="flex items-center gap-2">
							{#if item.isDirectory}<Folder class="size-4 text-amber-500" />{:else}<FileArchive class="size-4 text-primary/70" />{/if}
							{#if item.isDirectory}<button class="hover:underline" onclick={() => onOpenDirectory(item.path)}>{item.name}</button>{:else}<span>{item.name}</span>{/if}
						</div></td>
						<td class="px-3 py-3 text-muted-foreground">{item.isDirectory ? "--" : formatFileSize(item.size)}</td>
						<td class="px-3 py-3 text-xs text-muted-foreground">{item.modifiedAt ? new Date(item.modifiedAt).toLocaleString("zh-CN") : "--"}</td>
						<td class="flex items-center justify-end gap-1.5 px-3 py-3 text-right">
							{#if !item.isDirectory}
								<Button variant="ghost" size="icon" onclick={() => onInspect(item.path)} disabled={inspecting === item.path} class="size-8" aria-label="验证完整性">{#if inspecting === item.path}<RefreshCw class="size-3.5 animate-spin" />{:else}<ShieldCheck class="size-3.5" />{/if}</Button>
								<Button variant="ghost" size="icon" onclick={() => onDownload(item.path, item.name)} disabled={downloading === item.path} class="size-8" aria-label="下载备份">{#if downloading === item.path}<RefreshCw class="size-3.5 animate-spin" />{:else}<Download class="size-3.5" />{/if}</Button>
								<Button variant="outline" size="sm" onclick={() => onRestore(item.path)} disabled={restoring} class="h-7 border-amber-500/20 px-2.5 text-xs text-amber-600">{#if restoring}<RefreshCw class="mr-1 size-3 animate-spin" />{/if}全量恢复</Button>
								<Button variant="ghost" size="icon" onclick={() => onDelete(item.path)} disabled={deleting === item.path} class="size-8 text-destructive" aria-label="删除备份">{#if deleting === item.path}<RefreshCw class="size-3.5 animate-spin" />{:else}<Trash2 class="size-3.5" />{/if}</Button>
							{/if}
						</td>
					</tr>
				{/each}
				{#if items.length === 0}<tr><td colspan="4" class="py-8 text-center text-muted-foreground">{#if browsing}<RefreshCw class="mx-auto mb-2 size-5 animate-spin text-primary" /><span>正在检索文件列表...</span>{:else}<Info class="mx-auto mb-1.5 size-5" /><span>此备份目录中没有文件或没有读取权限。</span>{/if}</td></tr>{/if}
			</tbody>
		</table>
	</div>
</div>
