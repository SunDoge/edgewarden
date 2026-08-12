<script lang="ts">
import { CipherType } from "@edgewarden/shared";
import {
	ArrowLeft,
	BookUser,
	Building2,
	CreditCard,
	Database,
	FileText,
	Globe,
	IdCard,
	KeyRound,
	Landmark,
	Lock,
	Menu,
	LogOut,
	RefreshCw,
	ScrollText,
	Settings,
	Share2,
	ShieldAlert,
	ShieldCheck,
	User,
	UserRoundCog,
	WandSparkles,
	WifiOff,
} from "@lucide/svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Button } from "$lib/components/ui/button/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import VaultDialogs from "$lib/components/vault/VaultDialogs.svelte";
import VaultEditorForm from "$lib/components/vault/VaultEditorForm.svelte";
import VaultItemDetail from "$lib/components/vault/VaultItemDetail.svelte";
import VaultItemList from "$lib/components/vault/VaultItemList.svelte";
import VaultSidebar from "$lib/components/vault/VaultSidebar.svelte";
import {
	archiveCipherApi,
	createFolderApi,
	deleteAttachmentApi,
	deleteCipherApi,
	deleteFolderApi,
	deleteFoldersApi,
	hardDeleteCipherApi,
	isLoggedIn,
	restoreCipherApi,
	unarchiveCipherApi,
	updateFolderApi,
} from "$lib/services/api";
import {
	downloadVaultAttachment,
	uploadVaultAttachment,
} from "$lib/services/vault-attachments";
import { calcTotpNow, encryptStr } from "$lib/services/crypto";
import {
	applyVaultBulkAction,
	saveVaultCipher,
	updateEncryptedVaultCipher,
	type VaultBulkAction,
} from "$lib/services/vault-cipher-actions";
import {
	createVaultEditorForm,
	vaultCipherToEditorForm,
} from "$lib/services/vault-editor";
import {
	type DuplicateMode,
	filterAndSortVaultItems,
	findDuplicateCipherIds,
	type VaultCategory,
	type VaultSort,
} from "$lib/services/vault-filter";
import { formatVaultSyncTime as formatSyncTime } from "$lib/services/vault-item-display";
import {
	getOrganizationKey,
	logout,
	syncVaultData,
	vault,
} from "$lib/stores/vault.svelte";

// UI state
let searchQuery = $state("");
let activeCategory = $state<VaultCategory>("all");
let activeFolder = $state<string | null>(null);
let sortMode = $state<VaultSort>("edited");
let duplicateMode = $state<DuplicateMode>("exact");
let selectedIds = $state<Record<string, boolean>>({});
let moveDialogOpen = $state(false);
let moveFolderId = $state<string | null>(null);
let selectedItem = $state<any | null>(null);
let totpLive = $state<{ code: string; remain: number } | null>(null);
let deleteDialogOpen = $state(false);
let deleteLoading = $state(false);
let attachmentBusy = $state<string | null>(null);
let mobileSidebarOpen = $state(false);
let mobileDetailOpen = $state(false);

// Folder management dialog state
let folderDialogOpen = $state(false);
let folderDialogMode = $state<"create" | "rename">("create");
let folderDialogName = $state("");
let folderDialogLoading = $state(false);
let targetFolder = $state<any | null>(null);

let deleteFolderDialogOpen = $state(false);
let deleteFolderLoading = $state(false);
let deleteAllFoldersDialogOpen = $state(false);

function openCreateFolder() {
	folderDialogMode = "create";
	folderDialogName = "";
	targetFolder = null;
	folderDialogOpen = true;
}

function openRenameFolder(folder: any) {
	folderDialogMode = "rename";
	folderDialogName = folder.name;
	targetFolder = folder;
	folderDialogOpen = true;
}

function openDeleteFolder(folder: any) {
	targetFolder = folder;
	deleteFolderDialogOpen = true;
}

async function handleFolderSubmit() {
	if (!folderDialogName.trim()) return;
	folderDialogLoading = true;
	try {
		if (!vault.symEncKey || !vault.symMacKey) {
			throw new Error("密钥未就绪，请重新解锁保险库");
		}
		const encryptedName = await encryptStr(
			folderDialogName.trim(),
			vault.symEncKey,
			vault.symMacKey,
		);

		if (folderDialogMode === "create") {
			await createFolderApi({ name: encryptedName });
		} else if (folderDialogMode === "rename" && targetFolder) {
			await updateFolderApi(targetFolder.id, { name: encryptedName });
		}

		await syncVaultData();
		folderDialogOpen = false;
	} catch (e: any) {
		alert("操作文件夹失败: " + (e.message || e));
	} finally {
		folderDialogLoading = false;
	}
}

async function confirmDeleteFolder() {
	if (!targetFolder) return;
	deleteFolderLoading = true;
	try {
		await deleteFolderApi(targetFolder.id);
		if (activeFolder === targetFolder.id) {
			activeFolder = null;
		}
		await syncVaultData();
		deleteFolderDialogOpen = false;
	} catch (e: any) {
		alert("删除文件夹失败: " + (e.message || e));
	} finally {
		deleteFolderLoading = false;
	}
}

async function confirmDeleteAllFolders() {
	if (!vault.folders.length) return;
	deleteFolderLoading = true;
	try {
		await deleteFoldersApi(vault.folders.map((folder) => folder.id));
		activeFolder = null;
		await syncVaultData();
		deleteAllFoldersDialogOpen = false;
	} catch (e: any) {
		alert("删除全部文件夹失败: " + (e.message || e));
	} finally {
		deleteFolderLoading = false;
	}
}

async function updateTotp() {
	if (selectedItem?.type === CipherType.Login && selectedItem.login?.totp) {
		try {
			const res = await calcTotpNow(selectedItem.login.totp);
			totpLive = res;
		} catch {
			totpLive = null;
		}
	} else {
		totpLive = null;
	}
}

$effect(() => {
	selectedItem;
	updateTotp();

	const interval = window.setInterval(() => {
		updateTotp();
	}, 1000);

	return () => {
		clearInterval(interval);
	};
});

// Form editor state
let isEditing = $state(false);
let isCreating = $state(false);

let editor = $state(createVaultEditorForm());

onMount(async () => {
	if (!isLoggedIn()) {
		goto("/login");
		return;
	}
	if (!vault.isUnlocked) {
		goto("/vault/unlock");
		return;
	}
	await syncVaultData();
	const requestedCipherId = page.url.searchParams.get("cipher");
	if (requestedCipherId) {
		selectedItem =
			vault.ciphers.find((cipher) => cipher.id === requestedCipherId) ?? null;
	}
});

// Derived filtering
let filteredItems = $derived(
	filterAndSortVaultItems(vault.ciphers, {
		category: activeCategory,
		folderId: activeFolder,
		query: searchQuery,
		sort: sortMode,
		duplicateMode,
	}),
);
let selectedIdList = $derived(
	Object.keys(selectedIds).filter((id) => selectedIds[id]),
);
let duplicateCount = $derived(
	findDuplicateCipherIds(vault.ciphers, duplicateMode).size,
);

async function handleLogout() {
	await logout();
	goto("/login");
}

async function refreshSelectedItem(id: string) {
	await syncVaultData();
	selectedItem = vault.ciphers.find((cipher) => cipher.id === id) ?? null;
}

async function handleAttachmentUpload(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	const cipher = selectedItem;
	input.value = "";
	if (!file || !cipher || cipher.deletedDate || cipher.readOnly) return;
	const ownerKey = cipher.organizationId
		? getOrganizationKey(cipher.organizationId)
		: vault.symEncKey && vault.symMacKey
			? { encKey: vault.symEncKey, macKey: vault.symMacKey }
			: null;
	if (!ownerKey) {
		alert("密钥未就绪，请重新解锁保险库");
		return;
	}
	attachmentBusy = "upload";
	try {
		await uploadVaultAttachment(cipher, file, ownerKey);
		await refreshSelectedItem(cipher.id);
	} catch (error) {
		alert(
			`附件上传失败：${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		attachmentBusy = null;
	}
}

async function handleAttachmentDownload(attachment: any) {
	if (!selectedItem || !attachment?._keys) return;
	attachmentBusy = attachment.id;
	try {
		const downloaded = await downloadVaultAttachment(
			selectedItem.id,
			attachment,
		);
		const bytes = downloaded.bytes.buffer.slice(
			downloaded.bytes.byteOffset,
			downloaded.bytes.byteOffset + downloaded.bytes.byteLength,
		) as ArrayBuffer;
		const url = URL.createObjectURL(new Blob([bytes]));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = downloaded.fileName;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	} catch (error) {
		alert(
			`附件下载失败：${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		attachmentBusy = null;
	}
}

async function handleAttachmentDelete(attachment: any) {
	const cipher = selectedItem;
	if (cipher?.readOnly) {
		alert("该组织条目为只读");
		return;
	}
	if (!cipher || !confirm(`确定删除附件“${attachment.fileName}”吗？`)) return;
	attachmentBusy = attachment.id;
	try {
		await deleteAttachmentApi(cipher.id, attachment.id);
		await refreshSelectedItem(cipher.id);
	} catch (error) {
		alert(
			`附件删除失败：${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		attachmentBusy = null;
	}
}

function startCreate() {
	selectedItem = null;
	isEditing = false;
	isCreating = true;
	mobileDetailOpen = true;
	editor = createVaultEditorForm(activeFolder);
}

function startEdit() {
	if (!selectedItem) return;
	if (selectedItem.readOnly) {
		alert("该组织条目为只读");
		return;
	}
	isCreating = false;
	isEditing = true;
	mobileDetailOpen = true;
	editor = vaultCipherToEditorForm(selectedItem);
}

function cancelEdit() {
	isCreating = false;
	if (!selectedItem) mobileDetailOpen = false;
	isEditing = false;
}

async function handleSaveCipher() {
	try {
		await saveVaultCipher({
			editor,
			selectedItem,
			isCreating,
			isEditing,
			resolveOwnerKey,
		});

		isCreating = false;
		isEditing = false;
		selectedItem = null;
		await syncVaultData();
	} catch (e: any) {
		alert("保存失败：" + (e.message || e));
	}
}

function handleDeleteCipher() {
	if (!selectedItem) return;
	if (selectedItem.readOnly) {
		alert("该组织条目为只读");
		return;
	}
	deleteDialogOpen = true;
}

async function confirmDeleteCipher() {
	if (!selectedItem) return;
	deleteLoading = true;
	try {
		if (selectedItem.deletedDate) await hardDeleteCipherApi(selectedItem.id);
		else await deleteCipherApi(selectedItem.id);
		deleteDialogOpen = false;
		selectedItem = null;
		isEditing = false;
		await syncVaultData();
	} catch (e: any) {
		alert("删除失败：" + (e.message || e));
	} finally {
		deleteLoading = false;
	}
}

async function restoreSelectedCipher() {
	if (!selectedItem?.deletedDate) return;
	if (selectedItem.readOnly) {
		alert("该组织条目为只读");
		return;
	}
	deleteLoading = true;
	try {
		await restoreCipherApi(selectedItem.id);
		selectedItem = null;
		await syncVaultData();
	} catch (e: any) {
		alert("恢复失败：" + (e.message || e));
	} finally {
		deleteLoading = false;
	}
}

async function toggleArchiveSelected() {
	if (!selectedItem || selectedItem.deletedDate) return;
	if (selectedItem.readOnly) {
		alert("该组织条目为只读");
		return;
	}
	deleteLoading = true;
	try {
		if (selectedItem.archivedDate) await unarchiveCipherApi(selectedItem.id);
		else await archiveCipherApi(selectedItem.id);
		selectedItem = null;
		await syncVaultData();
	} catch (e: any) {
		alert("归档操作失败：" + (e.message || e));
	} finally {
		deleteLoading = false;
	}
}

function toggleSelection(id: string) {
	selectedIds = { ...selectedIds, [id]: !selectedIds[id] };
}

function clearSelection() {
	selectedIds = {};
}

async function runBulkAction(
	action: VaultBulkAction,
) {
	if (!selectedIdList.length) return;
	const items = selectedIdList
		.map((id) => vault.ciphers.find((cipher) => cipher.id === id))
		.filter(Boolean) as any[];
	if (
		(action === "delete" || action === "permanent") &&
		!confirm(
			action === "permanent"
				? `永久删除选中的 ${selectedIdList.length} 项？此操作无法撤销。`
				: `将选中的 ${selectedIdList.length} 项移到回收站？`,
		)
	)
		return;
	deleteLoading = true;
	try {
		await applyVaultBulkAction(action, items);
		clearSelection();
		selectedItem = null;
		await syncVaultData();
	} catch (e: any) {
		alert("批量操作失败：" + (e.message || e));
	} finally {
		deleteLoading = false;
	}
}

function resolveOwnerKey(organizationId?: string | null) {
	return organizationId
		? getOrganizationKey(organizationId)
		: vault.symEncKey && vault.symMacKey
			? { encKey: vault.symEncKey, macKey: vault.symMacKey }
			: null;
}

async function moveSelectedItems() {
	deleteLoading = true;
	try {
		for (const id of selectedIdList) {
			const item = vault.ciphers.find((cipher) => cipher.id === id);
			if (item?.organizationId)
				throw new Error("组织条目使用集合，不能移动到个人文件夹");
			if (item && !item.deletedDate)
				await updateEncryptedVaultCipher(item, { folderId: moveFolderId }, resolveOwnerKey);
		}
		moveDialogOpen = false;
		clearSelection();
		await syncVaultData();
	} catch (e: any) {
		alert("移动失败：" + (e.message || e));
	} finally {
		deleteLoading = false;
	}
}

async function toggleFavorite(item: any) {
	deleteLoading = true;
	try {
		await updateEncryptedVaultCipher(item, { favorite: !item.favorite }, resolveOwnerKey);
		await syncVaultData();
		selectedItem =
			vault.ciphers.find((cipher) => cipher.id === item.id) ?? null;
	} catch (e: any) {
		alert("收藏操作失败：" + (e.message || e));
	} finally {
		deleteLoading = false;
	}
}
</script>

<svelte:head>
	<title>我的保险库 - Edgewarden</title>
</svelte:head>

<div class="h-screen bg-slate-50 dark:bg-slate-950 flex flex-col overflow-hidden">
	<!-- Navbar -->
	<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-2 sm:px-4 md:px-6">
		<div class="flex items-center gap-2.5">
			<Button variant="ghost" size="icon" class="md:hidden" onclick={() => mobileSidebarOpen = true} aria-label="打开保险库导航"><Menu /></Button>
			<div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
				<ShieldCheck class="size-5" />
			</div>
			<span class="hidden text-lg font-bold sm:inline">Edgewarden</span>

			{#if vault.isOffline}
				<span class="px-2 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 rounded-full border border-amber-200 dark:border-amber-900/50 flex items-center gap-1">
					<WifiOff class="size-3" />
					离线缓存
				</span>
			{:else}
				<span class="px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-200 dark:border-emerald-900/50">
					零知识加密保护中
				</span>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			{#if vault.syncedAt}
				<span class="text-xs text-slate-400 hidden sm:block">
					{vault.isOffline ? "缓存于" : "同步于"} {formatSyncTime(vault.syncedAt)}
				</span>
			{/if}
			<Button
				variant="ghost" size="sm"
				onclick={() => syncVaultData()}
				disabled={vault.isSyncing}
				class="text-slate-500"
			>
				<RefreshCw class="size-4 {vault.isSyncing ? 'animate-spin' : ''}" />
			</Button>
			<Button variant="ghost" size="sm" onclick={handleLogout} class="text-muted-foreground" aria-label="锁定并退出">
				<LogOut />
				<span class="hidden sm:inline">锁定并退出</span>
			</Button>
		</div>
	</header>
	{#if vault.warning}<div class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{vault.warning}</div>{/if}

	<div class="relative flex flex-1 overflow-hidden">
		<!-- Sidebar -->
		{#if mobileSidebarOpen}<button class="absolute inset-0 z-20 bg-black/40 md:hidden" onclick={() => mobileSidebarOpen = false} aria-label="关闭保险库导航"></button>{/if}
		<div class="absolute inset-y-0 left-0 z-30 transition-transform md:static md:z-auto md:translate-x-0 {mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}">
			<VaultSidebar
				bind:activeCategory
				bind:activeFolder
				{duplicateCount}
				onCreate={() => { mobileSidebarOpen = false; startCreate(); }}
				onCreateFolder={openCreateFolder}
				onRenameFolder={openRenameFolder}
				onDeleteFolder={openDeleteFolder}
				onDeleteAllFolders={() => (deleteAllFoldersDialogOpen = true)}
				onNavigate={() => mobileSidebarOpen = false}
			/>
		</div>

		<div class="flex min-w-0 flex-1 {mobileDetailOpen ? 'hidden md:flex' : 'flex'}">
		<VaultItemList
			items={filteredItems}
			isSyncing={vault.isSyncing}
			error={vault.error}
			{activeCategory}
			bind:searchQuery
			bind:duplicateMode
			bind:sortMode
			bind:selectedItem
			{selectedIds}
			selectedCount={selectedIdList.length}
			onToggleSelection={toggleSelection}
			onBulkAction={runBulkAction}
			onClearSelection={clearSelection}
			onMove={() => { moveFolderId = null; moveDialogOpen = true; }}
			onSelectItem={() => mobileDetailOpen = true}
		/>
		</div>

		<!-- Detail Panel -->
		<section class="{mobileDetailOpen ? 'flex' : 'hidden'} absolute inset-0 z-10 w-full flex-col overflow-y-auto border-l bg-background p-4 md:static md:flex md:w-96 md:shrink-0 md:p-6">
			<div class="mb-4 md:hidden"><Button variant="ghost" size="sm" onclick={() => { if (isCreating || isEditing) cancelEdit(); else mobileDetailOpen = false; }}><ArrowLeft />返回列表</Button></div>
			{#if isCreating || isEditing}
				<VaultEditorForm
					bind:form={editor}
					{isCreating}
					{isEditing}
					folders={vault.folders}
					organizations={vault.organizations}
					collections={vault.collections}
					onSave={handleSaveCipher}
					onDelete={handleDeleteCipher}
					onCancel={cancelEdit}
				/>
			{:else if selectedItem}
				<VaultItemDetail
					item={selectedItem}
					folders={vault.folders}
					totp={totpLive}
					{attachmentBusy}
					onFavorite={() => toggleFavorite(selectedItem)}
					onArchive={toggleArchiveSelected}
					onRestore={restoreSelectedCipher}
					onEdit={startEdit}
					onDelete={handleDeleteCipher}
					onAttachmentUpload={handleAttachmentUpload}
					onAttachmentDownload={handleAttachmentDownload}
					onAttachmentDelete={handleAttachmentDelete}
				/>
			{:else if vault.isSyncing}
				<div class="animate-pulse space-y-6">
					<div class="flex items-center gap-3">
						<div class="w-12 h-12 rounded-2xl bg-slate-200 dark:bg-slate-800 shrink-0"></div>
						<div class="flex-1 space-y-2">
							<div class="h-5 bg-slate-200 dark:bg-slate-800 rounded w-1/2"></div>
							<div class="h-3 bg-slate-200/60 dark:bg-slate-800/60 rounded w-1/3"></div>
						</div>
					</div>
					<hr class="border-slate-200 dark:border-slate-800" />
					<div class="space-y-4">
						{#each Array(3) as _}
							<div class="space-y-2">
								<div class="h-3 bg-slate-200/60 dark:bg-slate-800/60 rounded w-1/4"></div>
								<div class="h-10 bg-slate-200 dark:bg-slate-800 rounded w-full"></div>
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<div class="h-full flex flex-col items-center justify-center text-center text-slate-400 p-8">
					<Lock class="size-10 text-slate-300 dark:text-slate-700 mb-3" />
					<p class="font-medium text-sm">选择一个项目查看详情</p>
					<p class="text-xs text-slate-500 mt-1">点击列表中任何条目，将在此显示解密数据。</p>
				</div>
			{/if}
		</section>
	</div>
</div>

<VaultDialogs
	bind:deleteOpen={deleteDialogOpen}
	bind:deleteAllFoldersOpen={deleteAllFoldersDialogOpen}
	bind:moveOpen={moveDialogOpen}
	bind:folderOpen={folderDialogOpen}
	bind:deleteFolderOpen={deleteFolderDialogOpen}
	bind:moveFolderId
	bind:folderName={folderDialogName}
	selectedItemName={selectedItem?.name}
	selectedItemDeleted={!!selectedItem?.deletedDate}
	{deleteLoading}
	folders={vault.folders}
	selectedCount={selectedIdList.length}
	folderMode={folderDialogMode}
	folderLoading={folderDialogLoading || deleteFolderLoading}
	targetFolderName={targetFolder?.name}
	onDeleteItem={confirmDeleteCipher}
	onDeleteAllFolders={confirmDeleteAllFolders}
	onMoveItems={moveSelectedItems}
	onSaveFolder={handleFolderSubmit}
	onDeleteFolder={confirmDeleteFolder}
/>
