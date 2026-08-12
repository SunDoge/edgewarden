<script lang="ts">
import { ArrowLeft, Lock } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import type { VaultEditorForm as VaultEditorDraft } from "$lib/services/vault-editor";
import VaultEditorForm from "./VaultEditorForm.svelte";
import VaultItemDetail from "./VaultItemDetail.svelte";

let {
	visible,
	isCreating,
	isEditing,
	editor = $bindable(),
	selectedItem,
	folders,
	organizations,
	collections,
	totp,
	attachmentBusy,
	isSyncing,
	onBack,
	onSave,
	onDelete,
	onCancel,
	onFavorite,
	onArchive,
	onRestore,
	onEdit,
	onAttachmentUpload,
	onAttachmentDownload,
	onAttachmentDelete,
}: {
	visible: boolean;
	isCreating: boolean;
	isEditing: boolean;
	editor: VaultEditorDraft;
	selectedItem: any | null;
	folders: any[];
	organizations: any[];
	collections: any[];
	totp: { code: string; remain: number } | null;
	attachmentBusy: string | null;
	isSyncing: boolean;
	onBack: () => void;
	onSave: () => void;
	onDelete: () => void;
	onCancel: () => void;
	onFavorite: () => void;
	onArchive: () => void;
	onRestore: () => void;
	onEdit: () => void;
	onAttachmentUpload: (event: Event) => void;
	onAttachmentDownload: (attachment: any) => void;
	onAttachmentDelete: (attachment: any) => void;
} = $props();
</script>

<section class="{visible ? 'flex' : 'hidden'} absolute inset-0 z-10 w-full flex-col overflow-y-auto border-l bg-background p-4 md:static md:flex md:w-96 md:shrink-0 md:p-6">
	<div class="mb-4 md:hidden"><Button variant="ghost" size="sm" onclick={onBack}><ArrowLeft />返回列表</Button></div>
	{#if isCreating || isEditing}
		<VaultEditorForm bind:form={editor} {isCreating} {isEditing} {folders} {organizations} {collections} {onSave} {onDelete} {onCancel} />
	{:else if selectedItem}
		<VaultItemDetail item={selectedItem} {folders} {totp} {attachmentBusy} {onFavorite} {onArchive} {onRestore} {onEdit} {onDelete} {onAttachmentUpload} {onAttachmentDownload} {onAttachmentDelete} />
	{:else if isSyncing}
		<div class="animate-pulse space-y-6">
			<div class="flex items-center gap-3"><div class="size-12 shrink-0 rounded-2xl bg-slate-200 dark:bg-slate-800"></div><div class="flex-1 space-y-2"><div class="h-5 w-1/2 rounded bg-slate-200 dark:bg-slate-800"></div><div class="h-3 w-1/3 rounded bg-slate-200/60 dark:bg-slate-800/60"></div></div></div>
			<hr class="border-slate-200 dark:border-slate-800" />
			<div class="space-y-4">{#each Array(3) as _}<div class="space-y-2"><div class="h-3 w-1/4 rounded bg-slate-200/60 dark:bg-slate-800/60"></div><div class="h-10 w-full rounded bg-slate-200 dark:bg-slate-800"></div></div>{/each}</div>
		</div>
	{:else}
		<div class="flex h-full flex-col items-center justify-center p-8 text-center text-slate-400"><Lock class="mb-3 size-10 text-slate-300 dark:text-slate-700" /><p class="text-sm font-medium">选择一个项目查看详情</p><p class="mt-1 text-xs text-slate-500">点击列表中任何条目，将在此显示解密数据。</p></div>
	{/if}
</section>
