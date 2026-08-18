<script lang="ts">
import VaultFolderSidebar from "./VaultFolderSidebar.svelte";
import VaultSidebar from "./VaultSidebar.svelte";
import * as Sheet from "$lib/components/ui/sheet/index.js";
import type { VaultCategory } from "$lib/services/vault-filter";

let {
	mobileOpen = $bindable(false),
	activeCategory = $bindable<VaultCategory>("all"),
	activeFolder = $bindable<string | null>(null),
	duplicateCount,
	duplicateFolderCount,
	mergingDuplicateFolders,
	onCreate,
	onCreateFolder,
	onRenameFolder,
	onDeleteFolder,
	onDeleteAllFolders,
	onMergeDuplicateFolders,
}: {
	mobileOpen: boolean;
	activeCategory: VaultCategory;
	activeFolder: string | null;
	duplicateCount: number;
	duplicateFolderCount: number;
	mergingDuplicateFolders: boolean;
	onCreate: () => void;
	onCreateFolder: () => void;
	onRenameFolder: (folder: any) => void;
	onDeleteFolder: (folder: any) => void;
	onDeleteAllFolders: () => void;
	onMergeDuplicateFolders: () => void;
} = $props();

function closeMobile() {
	mobileOpen = false;
}
</script>

<!-- Sheet owns focus trapping and keyboard dismissal for the mobile navigation. -->
<Sheet.Root bind:open={mobileOpen}>
	<Sheet.Content side="left" class="w-72 gap-0 p-0 md:hidden" showCloseButton={false}>
		<Sheet.Header class="sr-only">
			<Sheet.Title>保险库导航</Sheet.Title>
			<Sheet.Description>筛选密码、管理文件夹并打开工具。</Sheet.Description>
		</Sheet.Header>
		<VaultSidebar
			bind:activeCategory
			bind:activeFolder
			{duplicateCount}
			onCreate={() => { closeMobile(); onCreate(); }}
			{onCreateFolder}
			{onRenameFolder}
			{onDeleteFolder}
			{onDeleteAllFolders}
			{onMergeDuplicateFolders}
			{duplicateFolderCount}
			{mergingDuplicateFolders}
			onNavigate={closeMobile}
		/>
	</Sheet.Content>
</Sheet.Root>

<div class="hidden md:flex">
	<VaultSidebar
		bind:activeCategory
		bind:activeFolder
		{duplicateCount}
		{onCreate}
		{onCreateFolder}
		{onRenameFolder}
		{onDeleteFolder}
		{onDeleteAllFolders}
		{onMergeDuplicateFolders}
		{duplicateFolderCount}
		{mergingDuplicateFolders}
	/>
	<VaultFolderSidebar
		bind:activeCategory
		bind:activeFolder
		{onCreateFolder}
		{onRenameFolder}
		{onDeleteFolder}
		{onDeleteAllFolders}
		{onMergeDuplicateFolders}
		{duplicateFolderCount}
		{mergingDuplicateFolders}
	/>
</div>
