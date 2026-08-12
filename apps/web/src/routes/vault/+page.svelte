<script lang="ts">
import { CipherType } from "@edgewarden/shared";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import VaultDialogs from "$lib/components/vault/VaultDialogs.svelte";
import VaultDetailPanel from "$lib/components/vault/VaultDetailPanel.svelte";
import VaultHeader from "$lib/components/vault/VaultHeader.svelte";
import VaultItemList from "$lib/components/vault/VaultItemList.svelte";
import VaultSidebar from "$lib/components/vault/VaultSidebar.svelte";
import { formatTime } from "$lib/i18n/format";
import { m } from "$lib/paraglide/messages.js";
import {
	archiveCipherApi,
	deleteAttachmentApi,
	deleteCipherApi,
	hardDeleteCipherApi,
	isLoggedIn,
	restoreCipherApi,
	unarchiveCipherApi,
} from "$lib/services/api";
import {
	downloadVaultAttachment,
	uploadVaultAttachment,
} from "$lib/services/vault-attachments";
import { calcTotpNow } from "$lib/services/crypto";
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
	type FolderEditorMode,
	removeAllVaultFolders,
	removeVaultFolder,
	saveVaultFolder,
} from "$lib/services/vault-folder-actions";
import {
	type DuplicateMode,
	filterAndSortVaultItems,
	findDuplicateCipherIds,
	type VaultCategory,
	type VaultSort,
} from "$lib/services/vault-filter";
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
let saveNotice = $state<{ kind: "saved" | "warning"; message: string } | null>(
	null,
);

// Folder management dialog state
let folderDialogOpen = $state(false);
let folderDialogMode = $state<FolderEditorMode>("create");
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
		await saveVaultFolder({
			mode: folderDialogMode,
			name: folderDialogName,
			folderId: targetFolder?.id,
			encKey: vault.symEncKey,
			macKey: vault.symMacKey,
		});

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
		await removeVaultFolder(targetFolder.id);
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
		await removeAllVaultFolders(vault.folders);
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
	saveNotice = null;
	let saved: Awaited<ReturnType<typeof saveVaultCipher>>;
	try {
		saved = await saveVaultCipher({
			editor,
			selectedItem,
			isCreating,
			isEditing,
			resolveOwnerKey,
		});
	} catch (e: any) {
		alert("保存失败：" + (e.message || e));
		return;
	}

	// The mutation response is the server acknowledgement. Keep this separate
	// from the following pull so a refresh failure is never reported as a save
	// failure after D1 has already committed the encrypted item.
	saveNotice = {
		kind: "saved",
		message: m.vault_saved_to_server({
			time: formatTime(saved.revisionDate),
		}),
	};
	isCreating = false;
	isEditing = false;
	selectedItem = null;
	try {
		await syncVaultData();
	} catch {
		// The server acknowledgement above remains authoritative even when the
		// subsequent pull cannot refresh the local snapshot.
	}
	if (vault.isOffline || vault.status === "error") {
		saveNotice = {
			kind: "warning",
			message: m.vault_saved_refresh_failed(),
		};
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

async function runBulkAction(action: VaultBulkAction) {
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
				await updateEncryptedVaultCipher(
					item,
					{ folderId: moveFolderId },
					resolveOwnerKey,
				);
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
		await updateEncryptedVaultCipher(
			item,
			{ favorite: !item.favorite },
			resolveOwnerKey,
		);
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
	{#if saveNotice}
		<div class="fixed left-1/2 top-3 z-[60] -translate-x-1/2 rounded-md border px-3 py-2 text-sm font-medium shadow-lg {saveNotice.kind === 'saved' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'}" role="status">
			{saveNotice.message}
		</div>
	{/if}
	<VaultHeader onOpenNavigation={() => mobileSidebarOpen = true} onLogout={handleLogout} />

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

		<VaultDetailPanel
			visible={mobileDetailOpen}
			{isCreating}
			{isEditing}
			bind:editor
			{selectedItem}
			folders={vault.folders}
			organizations={vault.organizations}
			collections={vault.collections}
			totp={totpLive}
			{attachmentBusy}
			isSyncing={vault.isSyncing}
			onBack={() => { if (isCreating || isEditing) cancelEdit(); else mobileDetailOpen = false; }}
			onSave={handleSaveCipher}
			onDelete={handleDeleteCipher}
			onCancel={cancelEdit}
			onFavorite={() => toggleFavorite(selectedItem)}
			onArchive={toggleArchiveSelected}
			onRestore={restoreSelectedCipher}
			onEdit={startEdit}
			onAttachmentUpload={handleAttachmentUpload}
			onAttachmentDownload={handleAttachmentDownload}
			onAttachmentDelete={handleAttachmentDelete}
		/>
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
