<script lang="ts">
import { CipherType } from "@edgewarden/shared";
import {
	Archive,
	ArchiveRestore,
	ArrowLeft,
	BookUser,
	Building2,
	Check,
	Copy,
	CreditCard,
	Database,
	Download,
	Edit,
	ExternalLink,
	Eye,
	EyeOff,
	FileText,
	Folder,
	Globe,
	IdCard,
	KeyRound,
	Landmark,
	Lock,
	LogOut,
	Paperclip,
	RefreshCw,
	RotateCcw,
	ScrollText,
	Settings,
	Share2,
	ShieldAlert,
	ShieldCheck,
	Star,
	Trash2,
	Upload,
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
import { buildCipherPayload } from "$lib/services/cipher-draft";
import { calcTotpNow, encryptCipher, encryptStr } from "$lib/services/crypto";
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
import {
	formatVaultSyncTime as formatSyncTime,
	cipherDomain as getDomain,
	cipherExtraData as getExtraData,
	cipherTypeIcon as getItemIcon,
	cipherTypeName as getTypeName,
} from "$lib/services/vault-item-display";
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
let copiedField = $state<string | null>(null);
let showPassword = $state(false);
let showCardCode = $state(false);
let hiddenFieldsMap = $state<Record<number, boolean>>({});
let totpLive = $state<{ code: string; remain: number } | null>(null);
let deleteDialogOpen = $state(false);
let deleteLoading = $state(false);
let attachmentBusy = $state<string | null>(null);
let attachmentInput = $state<HTMLInputElement | null>(null);

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
	showPassword = false;
	showCardCode = false;
	hiddenFieldsMap = {};
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

function copyToClipboard(text: string, fieldName: string) {
	navigator.clipboard.writeText(text);
	copiedField = fieldName;
	setTimeout(() => {
		if (copiedField === fieldName) copiedField = null;
	}, 2000);
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
				{@const IconComp = getItemIcon(selectedItem.type)}
				<div class="space-y-6 animate-in fade-in duration-200">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3 min-w-0">
							<div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center shrink-0 overflow-hidden relative border border-slate-200/50 dark:border-slate-850">
								{#if getDomain(selectedItem)}
									<img
										src="/icons/{encodeURIComponent(getDomain(selectedItem) ?? "")}/icon.png"
										alt=""
										class="size-6.5 object-contain rounded-md"
										onload={(e) => {
											(e.currentTarget as HTMLImageElement).style.opacity = "1";
										}}
										onerror={(e) => {
											const target = e.currentTarget as HTMLImageElement;
											target.style.display = "none";
											const fallback = target.nextElementSibling as HTMLElement | null;
											if (fallback) fallback.classList.remove("hidden");
										}}
										style="opacity: 0; transition: opacity 0.2s;"
									/>
									<div class="absolute inset-0 flex items-center justify-center hidden">
										<IconComp class="size-6" />
									</div>
								{:else}
									<IconComp class="size-6" />
								{/if}
							</div>
							<div class="min-w-0">
								<h3 class="font-bold text-lg text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
									{selectedItem.name}
									{#if selectedItem.favorite}
										<Star class="size-4 fill-current text-amber-400 shrink-0" />
									{/if}
								</h3>
								<p class="text-xs text-slate-400 flex items-center gap-1 mt-0.5 flex-wrap">
									<span>{getTypeName(selectedItem.type)}</span>
									{#if selectedItem.folderId}
										{@const folder = vault.folders.find(f => f.id === selectedItem.folderId)}
										{#if folder}
											<span class="text-slate-350 dark:text-slate-700">•</span>
											<span class="flex items-center gap-0.5 max-w-[120px] truncate">
												<Folder class="size-3 text-slate-450 shrink-0" />
												{folder.name}
											</span>
										{/if}
									{/if}
								</p>
							</div>
						</div>
						<div class="flex gap-1.5 shrink-0">
							{#if !selectedItem.deletedDate && !selectedItem.readOnly}<Button variant="ghost" size="icon" onclick={() => toggleFavorite(selectedItem)} class="size-8.5 rounded-lg" title={selectedItem.favorite ? "取消收藏" : "收藏"}><Star class="size-4 {selectedItem.favorite ? 'fill-current text-amber-400' : ''}" /></Button>{/if}
							{#if !selectedItem.deletedDate && !selectedItem.readOnly}<Button variant="ghost" size="icon" onclick={toggleArchiveSelected} class="size-8.5 rounded-lg" title={selectedItem.archivedDate ? "取消归档" : "归档"}>{#if selectedItem.archivedDate}<ArchiveRestore class="size-4" />{:else}<Archive class="size-4" />{/if}</Button>{/if}
							{#if selectedItem.deletedDate && !selectedItem.readOnly}
								<Button variant="ghost" size="icon" onclick={restoreSelectedCipher} class="size-8.5 rounded-lg" title="恢复"><RotateCcw class="size-4" /></Button>
							{:else if !selectedItem.readOnly}
								<Button variant="ghost" size="icon" onclick={startEdit} class="size-8.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="编辑"><Edit class="size-4" /></Button>
							{/if}
							{#if !selectedItem.readOnly}<Button variant="ghost" size="icon" onclick={handleDeleteCipher} class="size-8.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" title="删除">
								<Trash2 class="size-4" />
							</Button>{/if}
						</div>
					</div>

					<hr class="border-slate-200 dark:border-slate-800" />

					<!-- Login -->
					{#if selectedItem.type === CipherType.Login}
						{@const login = selectedItem.login as Record<string, string>}
						<div class="space-y-4">
							{#if login?.username}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">用户名</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-medium truncate pr-2 select-all">{login.username}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(login.username, "username")}>
											{#if copiedField === "username"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if login?.password}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">密码</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-mono truncate pr-2 select-all">
										{#if showPassword && !selectedItem.hidePasswords}{login.password}{:else}••••••••••••{/if}
										</span>
										<div class="flex items-center gap-1 shrink-0">
										{#if !selectedItem.hidePasswords}<Button variant="ghost" size="icon" class="size-8" onclick={() => showPassword = !showPassword}>
												{#if showPassword}
													<EyeOff class="size-4 text-slate-400" />
												{:else}
													<Eye class="size-4 text-slate-400" />
												{/if}
										</Button>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(login.password, "password")}>
												{#if copiedField === "password"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
											</Button>
										{/if}
										</div>
									</div>
								</div>
							{/if}
							<!-- TOTP -->
							{#if login?.totp && !selectedItem.hidePasswords}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">单次有效密码 (TOTP)</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										{#if totpLive}
											<div class="flex items-center gap-2">
												<span class="text-sm font-mono font-bold tracking-wider text-primary select-all">
													{totpLive.code.slice(0, 3)} {totpLive.code.slice(3)}
												</span>
												<span class="text-xs text-slate-400">({totpLive.remain}s)</span>
											</div>
											<Button variant="ghost" size="icon" class="size-8 shrink-0" onclick={() => copyToClipboard(totpLive?.code || "", "totp")}>
												{#if copiedField === "totp"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
											</Button>
										{:else}
											<span class="text-xs text-slate-400">正在计算...</span>
										{/if}
									</div>
								</div>
							{/if}

							<!-- URIs -->
							{#if login?.uris && Array.isArray(login.uris) && login.uris.length > 0}
								<div class="space-y-2">
									<span class="text-xs font-semibold text-slate-400">网页链接列表</span>
									{#each login.uris as uriItem, idx}
										{#if uriItem.uri}
											<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
												<a href={uriItem.uri} target="_blank" rel="noopener noreferrer"
													class="text-sm text-primary font-medium hover:underline flex items-center gap-1 truncate pr-2">
													{uriItem.uri}<ExternalLink class="size-3 shrink-0" />
												</a>
												<Button variant="ghost" size="icon" class="size-8 shrink-0" onclick={() => copyToClipboard(uriItem.uri, `uri-${idx}`)}>
													{#if copiedField === `uri-${idx}`}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
												</Button>
											</div>
										{/if}
									{/each}
								</div>
							{:else}
								{#if login?.uri}
									<div class="space-y-1.5">
										<span class="text-xs font-semibold text-slate-400">网页链接</span>
										<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
											<a href={login.uri} target="_blank" rel="noopener noreferrer"
												class="text-sm text-primary font-medium hover:underline flex items-center gap-1 truncate pr-2">
												{login.uri}<ExternalLink class="size-3 shrink-0" />
											</a>
											<Button variant="ghost" size="icon" class="size-8 shrink-0" onclick={() => copyToClipboard(login.uri, "uri")}>
												{#if copiedField === "uri"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
											</Button>
										</div>
									</div>
								{/if}
							{/if}
						</div>
					{/if}

					<!-- Card -->
					{#if selectedItem.type === CipherType.Card}
						{@const card = selectedItem.card as Record<string, any>}
						<div class="space-y-4">
							{#if card?.cardholderName}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">持卡人</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">{card.cardholderName}</div>
								</div>
							{/if}
							{#if card?.number}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">卡号</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-mono truncate pr-2">{card.number.replace(/(.{4})/g, "$1 ").trim()}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(card.number, "card")}>
											{#if copiedField === "card"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if card?.brand}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">卡片品牌</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">
										{card.brand}
									</div>
								</div>
							{/if}
							{#if card?.expMonth || card?.expYear}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">有效期</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">
										{card.expMonth ?? ""}/{card.expYear ?? ""}
									</div>
								</div>
							{/if}
							{#if card?.code}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">安全码 (CVV)</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-mono truncate pr-2 select-all">
											{#if showCardCode}{card.code}{:else}•••{/if}
										</span>
										<div class="flex items-center gap-1 shrink-0">
											<Button variant="ghost" size="icon" class="size-8" onclick={() => showCardCode = !showCardCode}>
												{#if showCardCode}
													<EyeOff class="size-4 text-slate-400" />
												{:else}
													<Eye class="size-4 text-slate-400" />
												{/if}
											</Button>
											<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(card.code, "card-code")}>
												{#if copiedField === "card-code"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
											</Button>
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Identity -->
					{#if selectedItem.type === CipherType.Identity}
						{@const id = selectedItem.identity as Record<string, any>}
						<div class="space-y-4">
							{#if id?.firstName || id?.lastName}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">姓名</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">
										{id.lastName ?? ""} {id.firstName ?? ""}
									</div>
								</div>
							{/if}
							{#if id?.username}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">用户名</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-medium truncate pr-2 select-all">{id.username}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(id.username, "id-username")}>
											{#if copiedField === "id-username"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if id?.email}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">电子邮箱</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-medium truncate pr-2 select-all">{id.email}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(id.email, "id-email")}>
											{#if copiedField === "id-email"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if id?.phone}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">电话号码</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-medium truncate pr-2 select-all">{id.phone}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(id.phone, "id-phone")}>
											{#if copiedField === "id-phone"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if id?.company}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">公司 / 组织</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">{id.company}</div>
								</div>
							{/if}
							{#if id?.number}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">证件号码</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-mono truncate pr-2">{id.number}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(id.number, "id-number")}>
											{#if copiedField === "id-number"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if id?.address1 || id?.city || id?.country}
								{@const fullAddress = [id.address1, id.address2, id.address3, id.city, id.state, id.postalCode, id.country].filter(Boolean).join(", ")}
								{#if fullAddress}
									<div class="space-y-1.5">
										<span class="text-xs font-semibold text-slate-400">地址</span>
										<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium leading-relaxed">{fullAddress}</div>
									</div>
								{/if}
							{/if}
						</div>
					{/if}

					{#if getExtraData(selectedItem)}
						<div class="space-y-3">
							{#each Object.entries(getExtraData(selectedItem) ?? {}) as [key, value]}
								<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400">{key}</span><div class="flex items-center justify-between rounded-lg border bg-white p-2 dark:bg-slate-800"><span class="break-all text-sm font-mono">{String(value ?? "")}</span><Button variant="ghost" size="icon-sm" onclick={() => copyToClipboard(String(value ?? ""), `extra-${key}`)} aria-label={`复制 ${key}`}><Copy /></Button></div></div>
							{/each}
						</div>
					{/if}

					<!-- Notes -->
					{#if selectedItem.notes}
						<div class="space-y-1.5">
							<span class="text-xs font-semibold text-slate-400">便签</span>
							<div class="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm whitespace-pre-wrap leading-relaxed">
								{selectedItem.notes}
							</div>
						</div>
					{/if}

					<!-- Custom Fields -->
					{#if selectedItem.fields && selectedItem.fields.length > 0}
						<div class="border-t border-slate-200 dark:border-slate-800/80 pt-4 mt-4 space-y-4">
							<h4 class="font-bold text-xs text-slate-400 uppercase tracking-wider">自定义字段</h4>
							{#each selectedItem.fields as field, idx}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-500">{field.name || "未命名"}</span>
									
									{#if field.type === 2 || field.type === "2"}
										<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border flex items-center gap-2">
											<input type="checkbox" checked={field.value === "true" || field.value === true} disabled class="rounded border-slate-300 text-primary size-4" />
											<span class="text-sm font-medium text-slate-700 dark:text-slate-300">
												{#if field.value === "true" || field.value === true}是{:else}否{/if}
											</span>
										</div>
									{:else if field.type === 1 || field.type === "1"}
										<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
											<span class="text-sm font-mono truncate pr-2 select-all">
												{#if hiddenFieldsMap[idx]}{field.value}{:else}••••••••••••{/if}
											</span>
											<div class="flex items-center gap-1 shrink-0">
												<Button variant="ghost" size="icon" class="size-8" onclick={() => hiddenFieldsMap[idx] = !hiddenFieldsMap[idx]}>
													{#if hiddenFieldsMap[idx]}
														<EyeOff class="size-4 text-slate-400" />
													{:else}
														<Eye class="size-4 text-slate-400" />
													{/if}
												</Button>
												<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(field.value, `field-${idx}`)}>
													{#if copiedField === `field-${idx}`}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
												</Button>
											</div>
										</div>
									{:else}
										<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
											<span class="text-sm font-medium truncate pr-2 select-all">{field.value || ""}</span>
											<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(field.value, `field-${idx}`)}>
												{#if copiedField === `field-${idx}`}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
											</Button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<!-- Attachments are encrypted in the browser before upload. -->
					{#if !selectedItem.deletedDate}
						<div class="border-t border-slate-200 pt-4 dark:border-slate-800/80">
							<div class="mb-3 flex items-center justify-between gap-2">
								<h4 class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400"><Paperclip class="size-3.5" />附件</h4>
								<input bind:this={attachmentInput} type="file" class="sr-only" onchange={handleAttachmentUpload} aria-label="选择要上传的附件" />
								{#if !selectedItem.readOnly}<Button type="button" size="xs" variant="outline" disabled={attachmentBusy !== null} onclick={() => attachmentInput?.click()}>
									<Upload />{attachmentBusy === "upload" ? "正在加密…" : "添加附件"}
								</Button>{/if}
							</div>
							{#if selectedItem.attachments?.length}
								<div class="space-y-2">
									{#each selectedItem.attachments as attachment (attachment.id)}
										<div class="flex items-center gap-2 rounded-lg border bg-white p-2 dark:bg-slate-800">
											<Paperclip class="size-4 shrink-0 text-slate-400" />
											<div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{attachment.fileName}</p><p class="text-[11px] text-slate-400">{attachment.sizeName}</p></div>
											<Button type="button" variant="ghost" size="icon-sm" disabled={attachmentBusy !== null} onclick={() => handleAttachmentDownload(attachment)} aria-label={`下载 ${attachment.fileName}`}><Download /></Button>
											{#if !selectedItem.readOnly}<Button type="button" variant="ghost" size="icon-sm" disabled={attachmentBusy !== null} onclick={() => handleAttachmentDelete(attachment)} aria-label={`删除 ${attachment.fileName}`} class="text-red-500"><Trash2 /></Button>{/if}
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-xs text-slate-400">暂无附件。文件内容和文件名均在浏览器中加密。</p>
							{/if}
						</div>
					{/if}

					<!-- Item History Meta -->
					<div class="border-t border-slate-200 dark:border-slate-800/80 pt-4 mt-6 text-[11px] text-slate-400 dark:text-slate-500 space-y-1 bg-slate-50/50 dark:bg-slate-900/50 p-3 rounded-lg">
						{#if selectedItem.creationDate}
							<p class="flex justify-between">
								<span>创建时间</span>
								<span>{new Date(selectedItem.creationDate).toLocaleString("zh-CN")}</span>
							</p>
						{/if}
						{#if selectedItem.revisionDate}
							<p class="flex justify-between">
								<span>修改时间</span>
								<span>{new Date(selectedItem.revisionDate).toLocaleString("zh-CN")}</span>
							</p>
						{/if}
					</div>
				</div>
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
