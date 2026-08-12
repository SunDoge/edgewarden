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
	archiveCiphersApi,
	createAttachmentApi,
	createCipherApi,
	createFolderApi,
	deleteAttachmentApi,
	deleteCipherApi,
	deleteCiphersApi,
	deleteFolderApi,
	deleteFoldersApi,
	downloadAttachmentApi,
	hardDeleteCipherApi,
	hardDeleteCiphersApi,
	isLoggedIn,
	restoreCipherApi,
	restoreCiphersApi,
	unarchiveCipherApi,
	unarchiveCiphersApi,
	updateCipherApi,
	updateFolderApi,
	uploadAttachmentApi,
} from "$lib/services/api";
import {
	type AttachmentKeys,
	decryptAttachmentFile,
	prepareAttachment,
	safeAttachmentFileName,
} from "$lib/services/attachment-crypto";
import { encryptCipher } from "$lib/services/cipher-crypto";
import { buildCipherPayload } from "$lib/services/cipher-draft";
import { calcTotpNow, encryptStr } from "$lib/services/crypto";
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
	let createdId: string | null = null;
	try {
		const prepared = await prepareAttachment(
			cipher,
			file,
			ownerKey.encKey,
			ownerKey.macKey,
		);
		const created = await createAttachmentApi(cipher.id, prepared.metadata);
		createdId = created.attachmentId;
		await uploadAttachmentApi(created.url, prepared.encryptedData);
		await refreshSelectedItem(cipher.id);
	} catch (error) {
		if (createdId) {
			try {
				await deleteAttachmentApi(cipher.id, createdId);
			} catch {
				/* best-effort metadata cleanup */
			}
		}
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
		const encrypted = await downloadAttachmentApi(
			selectedItem.id,
			attachment.id,
		);
		const plain = await decryptAttachmentFile(
			encrypted,
			attachment._keys as AttachmentKeys,
		);
		const bytes = plain.buffer.slice(
			plain.byteOffset,
			plain.byteOffset + plain.byteLength,
		) as ArrayBuffer;
		const url = URL.createObjectURL(new Blob([bytes]));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = safeAttachmentFileName(attachment.fileName);
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
	editor = vaultCipherToEditorForm(selectedItem);
}

function cancelEdit() {
	isCreating = false;
	isEditing = false;
}

async function handleSaveCipher() {
	try {
		const payload = buildCipherPayload(
			{
				type: editor.type,
				name: editor.name,
				notes: editor.notes,
				favorite: editor.favorite,
				folderId: editor.folderId,
				login: {
					username: editor.loginUsername,
					password: editor.loginPassword,
					uri: editor.loginUri,
					uris: editor.loginUris,
					totp: editor.loginTotp,
				},
				card: {
					cardholderName: editor.cardholderName,
					number: editor.cardNumber,
				},
				identity: {
					firstName: editor.firstName,
					lastName: editor.lastName,
					number: editor.identityNumber,
				},
				customFields: editor.customFields,
				extraData: editor.extraData,
			},
			selectedItem,
			isEditing,
		);
		const ownerKey = editor.organizationId
			? getOrganizationKey(editor.organizationId)
			: vault.symEncKey && vault.symMacKey
				? { encKey: vault.symEncKey, macKey: vault.symMacKey }
				: null;
		if (!ownerKey) {
			throw new Error("密钥未就绪，请重新解锁保险库");
		}
		if (editor.organizationId && !editor.collectionIds.length)
			throw new Error("组织条目至少需要选择一个集合");
		const encryptedPayload = await encryptCipher(
			{
				...payload,
				folderId: editor.organizationId ? null : payload.folderId,
				organizationId: editor.organizationId,
				collectionIds: editor.organizationId ? editor.collectionIds : [],
			},
			ownerKey.encKey,
			ownerKey.macKey,
		);
		if (isCreating) {
			await createCipherApi(encryptedPayload);
		} else if (isEditing && selectedItem) {
			await updateCipherApi(selectedItem.id, encryptedPayload);
		}

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
	action: "delete" | "restore" | "permanent" | "archive" | "unarchive",
) {
	if (!selectedIdList.length) return;
	const items = selectedIdList
		.map((id) => vault.ciphers.find((cipher) => cipher.id === id))
		.filter(Boolean) as any[];
	if (items.some((item) => item.readOnly)) {
		alert("选择中包含只读组织条目");
		return;
	}
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
		const personalIds = items
			.filter((item) => !item.organizationId)
			.map((item) => item.id);
		const organizationItems = items.filter((item) => item.organizationId);
		if (personalIds.length) {
			if (action === "restore") await restoreCiphersApi(personalIds);
			else if (action === "archive") await archiveCiphersApi(personalIds);
			else if (action === "unarchive") await unarchiveCiphersApi(personalIds);
			else if (action === "permanent") await hardDeleteCiphersApi(personalIds);
			else await deleteCiphersApi(personalIds);
		}
		for (const item of organizationItems) {
			if (action === "restore") await restoreCipherApi(item.id);
			else if (action === "archive") await archiveCipherApi(item.id);
			else if (action === "unarchive") await unarchiveCipherApi(item.id);
			else if (action === "permanent") await hardDeleteCipherApi(item.id);
			else await deleteCipherApi(item.id);
		}
		clearSelection();
		selectedItem = null;
		await syncVaultData();
	} catch (e: any) {
		alert("批量操作失败：" + (e.message || e));
	} finally {
		deleteLoading = false;
	}
}

async function encryptAndUpdateItem(
	item: any,
	changes: Record<string, unknown>,
) {
	if (item.readOnly) throw new Error("该组织条目为只读");
	const ownerKey = item.organizationId
		? getOrganizationKey(item.organizationId)
		: vault.symEncKey && vault.symMacKey
			? { encKey: vault.symEncKey, macKey: vault.symMacKey }
			: null;
	if (!ownerKey) throw new Error("保险库密钥不可用");
	const encrypted = await encryptCipher(
		{ ...item, ...changes },
		ownerKey.encKey,
		ownerKey.macKey,
	);
	await updateCipherApi(item.id, encrypted);
}

async function moveSelectedItems() {
	deleteLoading = true;
	try {
		for (const id of selectedIdList) {
			const item = vault.ciphers.find((cipher) => cipher.id === id);
			if (item?.organizationId)
				throw new Error("组织条目使用集合，不能移动到个人文件夹");
			if (item && !item.deletedDate)
				await encryptAndUpdateItem(item, { folderId: moveFolderId });
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
		await encryptAndUpdateItem(item, { favorite: !item.favorite });
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
	<header class="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between shrink-0">
		<div class="flex items-center gap-2.5">
			<div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
				<ShieldCheck class="size-5" />
			</div>
			<span class="font-bold text-lg text-slate-800 dark:text-slate-100">Edgewarden</span>

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
			<Button variant="ghost" size="sm" onclick={handleLogout} class="text-slate-500 hover:text-red-600">
				<LogOut class="size-4 mr-2" />
				锁定并退出
			</Button>
		</div>
	</header>
	{#if vault.warning}<div class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{vault.warning}</div>{/if}

	<div class="flex-1 flex overflow-hidden">
		<!-- Sidebar -->
		<VaultSidebar
			bind:activeCategory
			bind:activeFolder
			{duplicateCount}
			onCreate={startCreate}
			onCreateFolder={openCreateFolder}
			onRenameFolder={openRenameFolder}
			onDeleteFolder={openDeleteFolder}
			onDeleteAllFolders={() => (deleteAllFoldersDialogOpen = true)}
		/>

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
		/>

		<!-- Detail Panel -->
		<section class="w-96 bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shrink-0 overflow-y-auto p-6">
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
