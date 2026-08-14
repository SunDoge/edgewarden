<script lang="ts">
import type { FolderResponse } from "@edgewarden/shared";
import { Combine, Edit, Folder, Plus, Trash2 } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import type { VaultCategory } from "$lib/services/vault-filter";
import { vault } from "$lib/stores/vault.svelte";
import { cn } from "$lib/utils";

let {
	activeCategory = $bindable(),
	activeFolder = $bindable(),
	onCreateFolder,
	onRenameFolder,
	onDeleteFolder,
	onDeleteAllFolders,
	onMergeDuplicateFolders,
	duplicateFolderCount,
	mergingDuplicateFolders,
}: {
	activeCategory: VaultCategory;
	activeFolder: string | null;
	onCreateFolder: () => void;
	onRenameFolder: (folder: FolderResponse) => void;
	onDeleteFolder: (folder: FolderResponse) => void;
	onDeleteAllFolders: () => void;
	onMergeDuplicateFolders: () => void;
	duplicateFolderCount: number;
	mergingDuplicateFolders: boolean;
} = $props();

function selectFolder(folderId: string | null) {
	activeFolder = folderId;
	activeCategory = "all";
}
</script>

<aside class="hidden h-full w-56 shrink-0 flex-col border-r bg-background md:flex" aria-label="文件夹">
	<header class="flex h-14 items-center justify-between border-b px-4">
		<h2 class="text-sm font-semibold">文件夹</h2>
		<div class="flex items-center gap-1">
			{#if duplicateFolderCount}
				<Button variant="ghost" size="icon-sm" onclick={onMergeDuplicateFolders} disabled={mergingDuplicateFolders} title={`合并 ${duplicateFolderCount} 个同名重复文件夹`} aria-label="合并同名重复文件夹"><Combine data-icon /></Button>
			{/if}
			{#if vault.folders.length}
				<Button variant="ghost" size="icon-sm" onclick={onDeleteAllFolders} title="删除全部文件夹" aria-label="删除全部文件夹" class="text-muted-foreground hover:text-destructive"><Trash2 data-icon /></Button>
			{/if}
			<Button variant="ghost" size="icon-sm" onclick={onCreateFolder} title="新建文件夹" aria-label="新建文件夹" class="text-muted-foreground"><Plus data-icon /></Button>
		</div>
	</header>

	<nav class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
		<button class={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors", activeFolder === null && activeCategory === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")} onclick={() => selectFolder(null)}>
			<Folder class="size-4 shrink-0" />
			<span class="truncate">所有文件夹</span>
		</button>
		{#each vault.folders as folder (folder.id)}
			<div class={cn("group flex items-center rounded-lg transition-colors", activeFolder === folder.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
				<button class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm font-medium" onclick={() => selectFolder(folder.id)}>
					<Folder class="size-4 shrink-0" />
					<span class="truncate">{folder.name}</span>
				</button>
				<span class="mr-2 text-xs tabular-nums text-muted-foreground group-hover:hidden">{vault.ciphers.filter((item) => item.folderId === folder.id).length}</span>
				<div class="mr-1 hidden items-center gap-0.5 group-hover:flex">
					<Button variant="ghost" size="icon-xs" onclick={() => onRenameFolder(folder)} title="重命名" aria-label={`重命名 ${folder.name}`}><Edit data-icon /></Button>
					<Button variant="ghost" size="icon-xs" onclick={() => onDeleteFolder(folder)} title="删除" aria-label={`删除 ${folder.name}`} class="hover:text-destructive"><Trash2 data-icon /></Button>
				</div>
			</div>
		{:else}
			<p class="px-3 py-2 text-xs text-muted-foreground">暂无文件夹</p>
		{/each}
	</nav>
</aside>
