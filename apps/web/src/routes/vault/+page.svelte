<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { CipherType } from "@edgewarden/shared";
import {
	isLoggedIn,
	createCipherApi,
	updateCipherApi,
	deleteCipherApi,
	restoreCipherApi,
	archiveCipherApi,
	unarchiveCipherApi,
	hardDeleteCipherApi,
	deleteCiphersApi,
	restoreCiphersApi,
	archiveCiphersApi,
	unarchiveCiphersApi,
	hardDeleteCiphersApi,
	createFolderApi,
	updateFolderApi,
	deleteFolderApi,
	deleteFoldersApi,
	createAttachmentApi,
	uploadAttachmentApi,
	downloadAttachmentApi,
	deleteAttachmentApi,
} from "$lib/services/api";
import { vault, syncVaultData, logout, getOrganizationKey } from "$lib/stores/vault.svelte";
import { encryptCipher, calcTotpNow, encryptStr } from "$lib/services/crypto";
import { filterAndSortVaultItems, findDuplicateCipherIds, type DuplicateMode, type VaultCategory, type VaultSort } from "$lib/services/vault-filter";
import { buildCipherPayload } from "$lib/services/cipher-draft";
import { decryptAttachmentFile, prepareAttachment, safeAttachmentFileName, type AttachmentKeys } from "$lib/services/attachment-crypto";
import { match } from "ts-pattern";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Textarea } from "$lib/components/ui/textarea/index.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import {
	Search,
	Plus,
	Folder,
	LogOut,
	Star,
	KeyRound,
	CreditCard,
	User,
	FileText,
	Lock,
	ExternalLink,
	Copy,
	Check,
	ShieldCheck,
	WifiOff,
	RefreshCw,
	Globe,
	Edit,
	Trash2,
	ArrowLeft,
	Share2,
	Database,
	Upload,
	Eye,
	EyeOff,
	Settings,
	WandSparkles,
	RotateCcw,
	Landmark,
	IdCard,
	BookUser,
	Paperclip,
	Download,
	ShieldAlert,
	Archive,
	ArchiveRestore,
	UserRoundCog,
	ScrollText,
	Building2,
} from "@lucide/svelte";

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

let editType = $state<CipherType>(CipherType.Login);
let editName = $state("");
let editNotes = $state("");
let editFavorite = $state(false);
let editFolderId = $state<string | null>(null);
let editOrganizationId = $state<string | null>(null);
let editCollectionIds = $state<string[]>([]);

let loginUsername = $state("");
let loginPassword = $state("");
let loginUri = $state("");
let loginUris = $state<Array<{ uri: string; match: number | null }>>([{ uri: "", match: null }]);
let loginTotp = $state("");
let customFields = $state<Array<{ name: string; value: string; type: number }>>([]);
let extraData = $state("{}");

let cardholderName = $state("");
let cardNumber = $state("");

let firstName = $state("");
let lastName = $state("");
let identityNumber = $state("");

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
		selectedItem = vault.ciphers.find((cipher) => cipher.id === requestedCipherId) ?? null;
	}
});

// Derived filtering
let filteredItems = $derived(filterAndSortVaultItems(vault.ciphers, { category: activeCategory, folderId: activeFolder, query: searchQuery, sort: sortMode, duplicateMode }));
let selectedIdList = $derived(Object.keys(selectedIds).filter((id) => selectedIds[id]));
let duplicateCount = $derived(findDuplicateCipherIds(vault.ciphers, duplicateMode).size);

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
	const ownerKey = cipher.organizationId ? getOrganizationKey(cipher.organizationId) : (vault.symEncKey && vault.symMacKey ? { encKey: vault.symEncKey, macKey: vault.symMacKey } : null);
	if (!ownerKey) {
		alert("密钥未就绪，请重新解锁保险库");
		return;
	}
	attachmentBusy = "upload";
	let createdId: string | null = null;
	try {
		const prepared = await prepareAttachment(cipher, file, ownerKey.encKey, ownerKey.macKey);
		const created = await createAttachmentApi(cipher.id, prepared.metadata);
		createdId = created.attachmentId;
		await uploadAttachmentApi(created.url, prepared.encryptedData);
		await refreshSelectedItem(cipher.id);
	} catch (error) {
		if (createdId) {
			try { await deleteAttachmentApi(cipher.id, createdId); } catch { /* best-effort metadata cleanup */ }
		}
		alert(`附件上传失败：${error instanceof Error ? error.message : String(error)}`);
	} finally {
		attachmentBusy = null;
	}
}

async function handleAttachmentDownload(attachment: any) {
	if (!selectedItem || !attachment?._keys) return;
	attachmentBusy = attachment.id;
	try {
		const encrypted = await downloadAttachmentApi(selectedItem.id, attachment.id);
		const plain = await decryptAttachmentFile(encrypted, attachment._keys as AttachmentKeys);
		const bytes = plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer;
		const url = URL.createObjectURL(new Blob([bytes]));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = safeAttachmentFileName(attachment.fileName);
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	} catch (error) {
		alert(`附件下载失败：${error instanceof Error ? error.message : String(error)}`);
	} finally {
		attachmentBusy = null;
	}
}

async function handleAttachmentDelete(attachment: any) {
	const cipher = selectedItem;
	if (cipher?.readOnly) { alert("该组织条目为只读"); return; }
	if (!cipher || !confirm(`确定删除附件“${attachment.fileName}”吗？`)) return;
	attachmentBusy = attachment.id;
	try {
		await deleteAttachmentApi(cipher.id, attachment.id);
		await refreshSelectedItem(cipher.id);
	} catch (error) {
		alert(`附件删除失败：${error instanceof Error ? error.message : String(error)}`);
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

function getDomain(item: any): string | null {
	if (item.type !== CipherType.Login) return null;
	const login = item.login;
	if (!login) return null;

	let uriStr = login.uri;
	if (!uriStr && Array.isArray(login.uris) && login.uris.length > 0) {
		uriStr = login.uris[0]?.uri;
	}

	if (!uriStr || typeof uriStr !== "string") return null;

	try {
		let cleanUri = uriStr.trim();
		if (!/^https?:\/\//i.test(cleanUri)) {
			cleanUri = "https://" + cleanUri;
		}
		const url = new URL(cleanUri);
		const host = url.hostname.toLowerCase();
		return host.startsWith("www.") ? host.slice(4) : host;
	} catch {
		const match = uriStr.match(/^(?:https?:\/\/)?(?:www\.)?([^\/\?#:]+)/i);
		return match ? match[1].toLowerCase() : null;
	}
}

function getItemIcon(type: number) {
	return match(type)
		.with(CipherType.Login, () => KeyRound)
		.with(CipherType.SecureNote, () => FileText)
		.with(CipherType.Card, () => CreditCard)
		.with(CipherType.Identity, () => User)
		.with(CipherType.SshKey, () => KeyRound)
		.with(CipherType.BankAccount, () => Landmark)
		.with(CipherType.DriversLicense, () => IdCard)
		.with(CipherType.Passport, () => BookUser)
		.otherwise(() => Lock);
}

function getTypeName(type: number) {
	return match(type)
		.with(CipherType.Login, () => "登录凭据")
		.with(CipherType.SecureNote, () => "安全便签")
		.with(CipherType.Card, () => "支付卡片")
		.with(CipherType.Identity, () => "个人身份")
		.with(CipherType.SshKey, () => "SSH 密钥")
		.with(CipherType.BankAccount, () => "银行账户")
		.with(CipherType.DriversLicense, () => "驾驶证")
		.with(CipherType.Passport, () => "护照")
		.otherwise(() => "保险库项");
}

function getExtraData(item: any): Record<string, unknown> | null {
	return match(item.type)
		.with(CipherType.SshKey, () => item.sshKey ?? null)
		.with(CipherType.BankAccount, () => item.bankAccount ?? null)
		.with(CipherType.DriversLicense, () => item.driversLicense ?? null)
		.with(CipherType.Passport, () => item.passport ?? null)
		.otherwise(() => null);
}

function formatSyncTime(ts: number | null): string {
	if (!ts) return "";
	return new Date(ts).toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

// Action helpers
function startCreate() {
	selectedItem = null;
	isEditing = false;
	isCreating = true;

	editType = CipherType.Login;
	editName = "";
	editNotes = "";
	editFavorite = false;
	editFolderId = activeFolder;
	editOrganizationId = null;
	editCollectionIds = [];

	loginUsername = "";
	loginPassword = "";
	loginUri = "";
	loginUris = [{ uri: "", match: null }];
	loginTotp = "";
	customFields = [];
	extraData = "{}";

	cardholderName = "";
	cardNumber = "";

	firstName = "";
	lastName = "";
	identityNumber = "";
}

function startEdit() {
	if (!selectedItem) return;
	if (selectedItem.readOnly) { alert("该组织条目为只读"); return; }
	isCreating = false;
	isEditing = true;

	editType = selectedItem.type;
	editName = selectedItem.name;
	editNotes = selectedItem.notes ?? "";
	editFavorite = selectedItem.favorite;
	editFolderId = selectedItem.folderId;
	editOrganizationId = selectedItem.organizationId ?? null;
	editCollectionIds = [...(selectedItem.collectionIds ?? [])];

	loginUsername = "";
	loginPassword = "";
	loginUri = "";
	loginUris = [{ uri: "", match: null }];
	loginTotp = "";
	customFields = Array.isArray(selectedItem.fields) ? selectedItem.fields.map((field: any) => ({ name: field.name ?? "", value: field.value ?? "", type: Number(field.type ?? 0) })) : [];
	extraData = "{}";
	cardholderName = "";
	cardNumber = "";
	firstName = "";
	lastName = "";
	identityNumber = "";

	if (editType === CipherType.Login) {
		const login = selectedItem.login || {};
		loginUsername = login.username ?? "";
		loginPassword = login.password ?? "";
		loginUri = login.uri ?? "";
		loginUris = Array.isArray(login.uris) && login.uris.length ? login.uris.map((entry: any) => ({ uri: entry.uri ?? "", match: entry.match ?? null })) : [{ uri: login.uri ?? "", match: null }];
		loginTotp = login.totp ?? "";
	} else if (editType === CipherType.Card) {
		const card = selectedItem.card || {};
		cardholderName = card.cardholderName ?? "";
		cardNumber = card.number ?? "";
	} else if (editType === CipherType.Identity) {
		const id = selectedItem.identity || {};
		firstName = id.firstName ?? "";
		lastName = id.lastName ?? "";
		identityNumber = id.number ?? "";
	} else if (editType >= CipherType.SshKey) {
		const key = match(editType)
			.with(CipherType.SshKey, () => "sshKey")
			.with(CipherType.BankAccount, () => "bankAccount")
			.with(CipherType.DriversLicense, () => "driversLicense")
			.with(CipherType.Passport, () => "passport")
			.otherwise(() => "");
		extraData = JSON.stringify(selectedItem[key] ?? {}, null, 2);
	}
}

function cancelEdit() {
	isCreating = false;
	isEditing = false;
}

function toggleEditCollection(collectionId: string, checked: boolean) {
	editCollectionIds = checked
		? [...new Set([...editCollectionIds, collectionId])]
		: editCollectionIds.filter((id) => id !== collectionId);
}

async function handleSaveCipher() {
	try {
		const payload = buildCipherPayload({
			type: editType, name: editName, notes: editNotes, favorite: editFavorite, folderId: editFolderId,
			login: { username: loginUsername, password: loginPassword, uri: loginUri, uris: loginUris, totp: loginTotp },
			card: { cardholderName, number: cardNumber }, identity: { firstName, lastName, number: identityNumber },
			customFields, extraData,
		}, selectedItem, isEditing);
		const ownerKey = editOrganizationId ? getOrganizationKey(editOrganizationId) : (vault.symEncKey && vault.symMacKey ? { encKey: vault.symEncKey, macKey: vault.symMacKey } : null);
		if (!ownerKey) {
			throw new Error("密钥未就绪，请重新解锁保险库");
		}
		if (editOrganizationId && !editCollectionIds.length) throw new Error("组织条目至少需要选择一个集合");
		const encryptedPayload = await encryptCipher(
			{ ...payload, folderId: editOrganizationId ? null : payload.folderId, organizationId: editOrganizationId, collectionIds: editOrganizationId ? editCollectionIds : [] },
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
	if (selectedItem.readOnly) { alert("该组织条目为只读"); return; }
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
	if (selectedItem.readOnly) { alert("该组织条目为只读"); return; }
	deleteLoading = true;
	try { await restoreCipherApi(selectedItem.id); selectedItem = null; await syncVaultData(); } catch (e: any) { alert("恢复失败：" + (e.message || e)); } finally { deleteLoading = false; }
}

async function toggleArchiveSelected() {
	if (!selectedItem || selectedItem.deletedDate) return;
	if (selectedItem.readOnly) { alert("该组织条目为只读"); return; }
	deleteLoading = true;
	try {
		if (selectedItem.archivedDate) await unarchiveCipherApi(selectedItem.id);
		else await archiveCipherApi(selectedItem.id);
		selectedItem = null;
		await syncVaultData();
	} catch (e: any) { alert("归档操作失败：" + (e.message || e)); }
	finally { deleteLoading = false; }
}

function toggleSelection(id: string) {
	selectedIds = { ...selectedIds, [id]: !selectedIds[id] };
}

function clearSelection() { selectedIds = {}; }

async function runBulkAction(action: "delete" | "restore" | "permanent" | "archive" | "unarchive") {
	if (!selectedIdList.length) return;
	const items = selectedIdList.map((id) => vault.ciphers.find((cipher) => cipher.id === id)).filter(Boolean) as any[];
	if (items.some((item) => item.readOnly)) { alert("选择中包含只读组织条目"); return; }
	if ((action === "delete" || action === "permanent") && !confirm(action === "permanent" ? `永久删除选中的 ${selectedIdList.length} 项？此操作无法撤销。` : `将选中的 ${selectedIdList.length} 项移到回收站？`)) return;
	deleteLoading = true;
	try {
		const personalIds = items.filter((item) => !item.organizationId).map((item) => item.id);
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
		clearSelection(); selectedItem = null; await syncVaultData();
	} catch (e: any) { alert("批量操作失败：" + (e.message || e)); } finally { deleteLoading = false; }
}

async function encryptAndUpdateItem(item: any, changes: Record<string, unknown>) {
	if (item.readOnly) throw new Error("该组织条目为只读");
	const ownerKey = item.organizationId ? getOrganizationKey(item.organizationId) : (vault.symEncKey && vault.symMacKey ? { encKey: vault.symEncKey, macKey: vault.symMacKey } : null);
	if (!ownerKey) throw new Error("保险库密钥不可用");
	const encrypted = await encryptCipher({ ...item, ...changes }, ownerKey.encKey, ownerKey.macKey);
	await updateCipherApi(item.id, encrypted);
}

async function moveSelectedItems() {
	deleteLoading = true;
	try {
		for (const id of selectedIdList) {
			const item = vault.ciphers.find((cipher) => cipher.id === id);
			if (item?.organizationId) throw new Error("组织条目使用集合，不能移动到个人文件夹");
			if (item && !item.deletedDate) await encryptAndUpdateItem(item, { folderId: moveFolderId });
		}
		moveDialogOpen = false; clearSelection(); await syncVaultData();
	} catch (e: any) { alert("移动失败：" + (e.message || e)); } finally { deleteLoading = false; }
}

async function toggleFavorite(item: any) {
	deleteLoading = true;
	try { await encryptAndUpdateItem(item, { favorite: !item.favorite }); await syncVaultData(); selectedItem = vault.ciphers.find((cipher) => cipher.id === item.id) ?? null; } catch (e: any) { alert("收藏操作失败：" + (e.message || e)); } finally { deleteLoading = false; }
}

// Virtual Scroll state for performance with large password lists (similar to nodewarden)
let listContainer = $state<HTMLDivElement | null>(null);
let scrollTop = $state(0);
let viewportHeight = $state(0);
let currentBucket = $state(0);
const ROW_HEIGHT = 72;
const OVERSCAN = 5;

// Derived values for virtualization
let startIndex = $derived(
	Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN),
);
let endIndex = $derived(
	Math.min(
		filteredItems.length,
		Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
	),
);

let visibleItems = $derived(filteredItems.slice(startIndex, endIndex));

let padTop = $derived(startIndex * ROW_HEIGHT);
let padBottom = $derived(
	Math.max(0, (filteredItems.length - endIndex) * ROW_HEIGHT),
);

$effect(() => {
	// track changes to filters
	searchQuery;
	activeCategory;
	activeFolder;
	if (listContainer) {
		listContainer.scrollTop = 0;
		scrollTop = 0;
		currentBucket = 0;
	}
});
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
		<aside class="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 shrink-0 overflow-y-auto">
			<Button class="w-full mb-6 gap-2" onclick={startCreate}>
				<Plus class="size-4" />
				添加新条目
			</Button>

			<div class="space-y-1.5">
				<p class="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">类型过滤</p>

				{#each [
					{ id: "all" as VaultCategory, label: "全部条目", icon: Lock, count: vault.ciphers.filter(i => !i.deletedDate && !i.archivedDate).length },
					{ id: "favorites" as VaultCategory, label: "我的收藏", icon: Star, count: vault.ciphers.filter(i => i.favorite && !i.deletedDate && !i.archivedDate).length },
					{ id: "archive" as VaultCategory, label: "归档", icon: Archive, count: vault.ciphers.filter(i => i.archivedDate && !i.deletedDate).length },
					{ id: "trash" as VaultCategory, label: "回收站", icon: Trash2, count: vault.ciphers.filter(i => i.deletedDate).length },
					{ id: "duplicates" as VaultCategory, label: "重复项", icon: Copy, count: duplicateCount },
				] as cat}
					<button
						class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left
							{activeCategory === cat.id && !activeFolder ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}"
						onclick={() => { activeCategory = cat.id; activeFolder = null; }}
					>
						<cat.icon class="size-4" />
						<span>{cat.label}</span>
						<span class="ml-auto text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500">{cat.count}</span>
					</button>
				{/each}

				<hr class="border-slate-200 dark:border-slate-800 my-2" />

				{#each [
					{ id: "login" as VaultCategory, label: "登录凭据", icon: KeyRound },
					{ id: "card" as VaultCategory, label: "支付卡片", icon: CreditCard },
					{ id: "identity" as VaultCategory, label: "个人身份", icon: User },
					{ id: "securenote" as VaultCategory, label: "安全便签", icon: FileText },
				] as cat}
					<button
						class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left
							{activeCategory === cat.id ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}"
						onclick={() => { activeCategory = cat.id; activeFolder = null; }}
					>
						<cat.icon class="size-4" />
						<span>{cat.label}</span>
					</button>
				{/each}

				<hr class="border-slate-200 dark:border-slate-800 my-2" />

				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => goto("/vault/totp")}
				>
					<KeyRound class="size-4 text-slate-500" />
					<span>验证码</span>
				</button>

				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => goto("/vault/password-health")}
				>
					<ShieldAlert class="size-4 text-slate-500" />
					<span>密码健康</span>
				</button>

				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => goto("/vault/domains")}
				>
					<Globe class="size-4 text-slate-500" />
					<span>域名等效规则</span>
				</button>

				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => goto("/vault/sends")}
				>
					<Share2 class="size-4 text-slate-500" />
					<span>Send 传输中心</span>
				</button>

				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => goto("/vault/import-export")}
				>
					<Upload class="size-4 text-slate-500" />
					<span>导入与导出</span>
				</button>

				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => goto("/vault/organizations")}
				>
					<Building2 class="size-4 text-slate-500" />
					<span>组织共享</span>
				</button>

				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => goto("/vault/settings")}
				>
					<Settings class="size-4 text-slate-500" />
					<span>账户与安全</span>
				</button>

				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					onclick={() => goto("/vault/generator")}
				>
					<WandSparkles class="size-4 text-slate-500" />
					<span>密码生成器</span>
				</button>

				{#if vault.profile?.role === "admin"}
					<button
						class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
						onclick={() => goto("/vault/admin")}
					>
						<UserRoundCog class="size-4 text-slate-500" />
						<span>用户与邀请</span>
					</button>
					<button
						class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
						onclick={() => goto("/vault/logs")}
					>
						<ScrollText class="size-4 text-slate-500" />
						<span>审计日志</span>
					</button>
					<button
						class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
						onclick={() => goto("/vault/backups")}
					>
						<Database class="size-4 text-slate-500" />
						<span>云备份中心</span>
					</button>
				{/if}
			</div>

			<!-- Folders section with CRUD actions -->
			<div class="mt-6 space-y-1">
				<div class="flex items-center justify-between px-3 mb-2">
					<p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">文件夹</p>
					<div class="flex items-center gap-1">{#if vault.folders.length}<button
						class="text-slate-400 hover:text-red-600 transition-colors p-0.5 rounded"
						onclick={() => deleteAllFoldersDialogOpen = true}
						title="删除全部文件夹"
					><Trash2 class="size-3.5" /></button>{/if}<button
						class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-0.5 rounded"
						onclick={openCreateFolder}
						title="新建文件夹"
					>
						<Plus class="size-3.5" />
					</button></div>
				</div>
				{#each vault.folders as folder}
					<div class="w-full flex items-center justify-between group rounded-lg text-sm font-medium transition-colors text-left
						{activeFolder === folder.id ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}"
					>
						<button
							class="flex-1 flex items-center gap-3 px-3 py-2 text-left min-w-0 font-medium"
							onclick={() => { activeFolder = folder.id; activeCategory = "all"; }}
						>
							<Folder class="size-4 shrink-0" />
							<span class="truncate">{folder.name}</span>
						</button>
						<div class="flex items-center gap-1.5 pr-2 shrink-0">
							<span class="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 group-hover:hidden">
								{vault.ciphers.filter(i => i.folderId === folder.id).length}
							</span>
							<button
								class="hidden group-hover:inline-flex text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded"
								onclick={(e) => { e.stopPropagation(); openRenameFolder(folder); }}
								title="重命名"
							>
								<Edit class="size-3.5" />
							</button>
							<button
								class="hidden group-hover:inline-flex text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-0.5 rounded"
								onclick={(e) => { e.stopPropagation(); openDeleteFolder(folder); }}
								title="删除"
							>
								<Trash2 class="size-3.5" />
							</button>
						</div>
					</div>
				{/each}
				{#if vault.folders.length === 0}
					<p class="px-3 text-xs text-slate-400/80 italic">暂无文件夹</p>
				{/if}
			</div>
		</aside>

		<!-- Items List -->
		<section class="flex-1 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-hidden">
			<div class="p-4 border-b border-slate-200 dark:border-slate-800 shrink-0 flex flex-col gap-3">
				<div class="flex gap-2"><div class="relative flex-1">
					<Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
					<Input type="search" placeholder="搜索您的保险库项..." class="pl-10" bind:value={searchQuery} />
				</div>{#if activeCategory === "duplicates"}<select bind:value={duplicateMode} aria-label="重复检测方式" class="h-9 rounded-md border bg-background px-2 text-sm"><option value="exact">完全相同</option><option value="login-site">同一站点</option><option value="login-credentials">同站点和用户名</option><option value="password">相同密码</option></select>{/if}<select bind:value={sortMode} aria-label="排序方式" class="h-9 rounded-md border bg-background px-2 text-sm"><option value="edited">最近修改</option><option value="created">最近创建</option><option value="name">名称</option></select></div>
				{#if selectedIdList.length}<div class="flex flex-wrap items-center gap-2 text-sm"><span>已选择 {selectedIdList.length} 项</span>{#if activeCategory === "trash"}<Button size="sm" variant="outline" onclick={() => runBulkAction("restore")}><RotateCcw />恢复</Button><Button size="sm" variant="destructive" onclick={() => runBulkAction("permanent")}><Trash2 />永久删除</Button>{:else if activeCategory === "archive"}<Button size="sm" variant="outline" onclick={() => runBulkAction("unarchive")}><ArchiveRestore />取消归档</Button><Button size="sm" variant="destructive" onclick={() => runBulkAction("delete")}><Trash2 />移到回收站</Button>{:else}<Button size="sm" variant="outline" onclick={() => runBulkAction("archive")}><Archive />归档</Button><Button size="sm" variant="outline" onclick={() => { moveFolderId = null; moveDialogOpen = true; }}><Folder />移动</Button><Button size="sm" variant="destructive" onclick={() => runBulkAction("delete")}><Trash2 />移到回收站</Button>{/if}<Button size="sm" variant="ghost" onclick={clearSelection}>取消选择</Button></div>{/if}
			</div>

			<div
				bind:this={listContainer}
				bind:clientHeight={viewportHeight}
				onscroll={(e) => {
					const top = e.currentTarget.scrollTop;
					const bucket = Math.floor(Math.max(0, top) / ROW_HEIGHT);
					if (bucket !== currentBucket) {
						currentBucket = bucket;
						scrollTop = top;
					}
				}}
				class="flex-1 overflow-y-auto"
			>
				{#if vault.isSyncing}
					<div class="divide-y divide-slate-100 dark:divide-slate-800/50">
						{#each Array(6) as _}
							<div class="animate-pulse w-full p-4 flex items-center gap-3.5">
								<div class="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800 shrink-0"></div>
								<div class="flex-1 min-w-0 space-y-2 py-1">
									<div class="h-3.5 bg-slate-200 dark:bg-slate-800 rounded w-1/3"></div>
									<div class="h-2.5 bg-slate-200/60 dark:bg-slate-800/60 rounded w-1/2"></div>
								</div>
							</div>
						{/each}
					</div>
				{:else if vault.error}
					<div class="p-8 text-center text-slate-500 space-y-3">
						<WifiOff class="size-10 mx-auto text-slate-300 dark:text-slate-700" />
						<p class="text-sm">{vault.error}</p>
					</div>
				{:else if filteredItems.length === 0}
					<div class="p-12 text-center text-slate-400">
						<Lock class="size-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
						<p class="font-medium text-sm">找不到符合要求的条目</p>
						<p class="text-xs text-slate-500 mt-1">点击左侧"添加新条目"来创建一个。</p>
					</div>
				{:else}
					<div style="padding-top: {padTop}px; padding-bottom: {padBottom}px;" class="divide-y divide-slate-100 dark:divide-slate-800/50">
						{#each visibleItems as item (item.id)}
							{@const IconComp = getItemIcon(item.type)}
							<div class="flex items-center">
							<input type="checkbox" checked={!!selectedIds[item.id]} onchange={() => toggleSelection(item.id)} aria-label={`选择 ${item.name}`} class="ml-3 size-4 rounded border-input" />
							<button
								class="w-full p-4 flex items-center gap-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/30 text-left transition-colors
									{selectedItem?.id === item.id ? 'bg-primary/5 dark:bg-primary/10 border-l-2 border-primary' : 'border-l-2 border-transparent'}"
								onclick={() => selectedItem = item}
							>
								<div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center shrink-0 overflow-hidden relative border border-slate-200/50 dark:border-slate-850">
									{#if getDomain(item)}
										<img
											src="/icons/{encodeURIComponent(getDomain(item) ?? "")}/icon.png"
											alt=""
											class="size-5.5 object-contain rounded-md"
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
											<IconComp class="size-5" />
										</div>
									{:else}
										<IconComp class="size-5" />
									{/if}
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-1.5">
										<h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{item.name}</h4>
										{#if item.favorite}
											<Star class="size-3 fill-current text-amber-400 shrink-0" />
										{/if}
									</div>
									<p class="text-xs text-slate-500 truncate mt-0.5">
										{(item.login as any)?.username || getTypeName(item.type)}
									</p>
								</div>
							</button></div>
						{/each}
					</div>
				{/if}
			</div>
		</section>

		<!-- Detail Panel -->
		<section class="w-96 bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shrink-0 overflow-y-auto p-6">
			{#if isCreating || isEditing}
				<!-- Editor form -->
				<div class="space-y-6">
					<div class="flex items-center justify-between">
						<h3 class="font-bold text-lg text-slate-900 dark:text-slate-100">
							{isCreating ? "添加新条目" : "编辑条目"}
						</h3>
						<Button variant="ghost" size="sm" onclick={cancelEdit} class="text-slate-500 hover:text-red-500">
							取消
						</Button>
					</div>

					<hr class="border-slate-200 dark:border-slate-800" />

					<!-- Common fields -->
					<div class="space-y-4">
						{#if isCreating}
							<div class="space-y-1.5">
								<span class="text-xs font-semibold text-slate-400 font-bold">条目类型</span>
								<select bind:value={editType} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
									<option value={CipherType.Login}>登录凭据</option>
									<option value={CipherType.SecureNote}>安全便签</option>
									<option value={CipherType.Card}>支付卡片</option>
									<option value={CipherType.Identity}>个人身份</option>
									<option value={CipherType.SshKey}>SSH 密钥</option>
									<option value={CipherType.BankAccount}>银行账户</option>
									<option value={CipherType.DriversLicense}>驾驶证</option>
									<option value={CipherType.Passport}>护照</option>
								</select>
							</div>
						{/if}

						<div class="space-y-1.5">
							<span class="text-xs font-semibold text-slate-400 font-bold">条目名称</span>
							<Input bind:value={editName} placeholder="例如: 我的个人邮箱" />
						</div>

						<div class="space-y-1.5">
							<span class="text-xs font-semibold text-slate-400 font-bold">所有者</span>
							<select bind:value={editOrganizationId} disabled={isEditing} onchange={() => { editFolderId = null; editCollectionIds = []; }} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60">
								<option value={null}>我的保险库</option>
								{#each vault.organizations as organization}
									<option value={organization.id}>{organization.name}</option>
								{/each}
							</select>
						</div>

						{#if editOrganizationId}
							<div class="space-y-2">
								<span class="text-xs font-semibold text-slate-400 font-bold">集合</span>
								{#each vault.collections.filter((collection) => collection.organizationId === editOrganizationId) as collection}
									<label class="flex items-center gap-2 text-sm">
										<input type="checkbox" checked={editCollectionIds.includes(collection.id)} disabled={Boolean(collection.readOnly)} onchange={(event) => toggleEditCollection(collection.id, event.currentTarget.checked)} />
										<span>{collection.name}{collection.readOnly ? "（只读）" : ""}</span>
									</label>
								{/each}
							</div>
						{:else}
							<div class="space-y-1.5">
								<span class="text-xs font-semibold text-slate-400 font-bold">文件夹</span>
								<select bind:value={editFolderId} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
									<option value={null}>无</option>
									{#each vault.folders as folder}
										<option value={folder.id}>{folder.name}</option>
									{/each}
								</select>
							</div>
						{/if}

						<div class="flex items-center gap-2 py-1">
							<input type="checkbox" id="favorite" bind:checked={editFavorite} class="rounded border-slate-300 text-primary focus:ring-primary size-4" />
							<label for="favorite" class="text-sm font-semibold text-slate-650 cursor-pointer">设为收藏</label>
						</div>

						<!-- Login Fields -->
						{#if editType === CipherType.Login}
							<div class="space-y-4 border-t border-slate-200 dark:border-slate-850 pt-4">
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400 font-bold">用户名</span>
									<Input bind:value={loginUsername} placeholder="用户名" />
								</div>
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400 font-bold">密码</span>
									<Input type="password" bind:value={loginPassword} placeholder="密码" />
								</div>
								<div class="space-y-2"><div class="flex items-center justify-between"><span class="text-xs font-semibold text-slate-400 font-bold">网页链接</span><Button type="button" size="xs" variant="ghost" onclick={() => loginUris = [...loginUris, { uri: "", match: null }]}><Plus />添加</Button></div>{#each loginUris as uri, index}<div class="flex gap-2"><Input bind:value={uri.uri} placeholder="https://example.com" /><select bind:value={uri.match} aria-label="匹配方式" class="w-28 rounded-md border bg-background px-2 text-xs"><option value={null}>默认</option><option value={0}>根域</option><option value={1}>主机</option><option value={3}>完全匹配</option><option value={2}>前缀</option><option value={4}>正则</option><option value={5}>从不</option></select>{#if loginUris.length > 1}<Button type="button" variant="ghost" size="icon-sm" onclick={() => loginUris = loginUris.filter((_, itemIndex) => itemIndex !== index)} aria-label="删除网址"><Trash2 /></Button>{/if}</div>{/each}</div>
								<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400 font-bold">TOTP 密钥或 otpauth URI</span><Input bind:value={loginTotp} autocomplete="off" /></div>
							</div>
						{/if}

						<!-- Card Fields -->
						{#if editType === CipherType.Card}
							<div class="space-y-4 border-t border-slate-200 dark:border-slate-850 pt-4">
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400 font-bold">持卡人姓名</span>
									<Input bind:value={cardholderName} placeholder="持卡人" />
								</div>
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400 font-bold">卡号</span>
									<Input bind:value={cardNumber} placeholder="卡号" />
								</div>
							</div>
						{/if}

						{#if editType >= CipherType.SshKey}
							<div class="space-y-1.5 border-t pt-4"><span class="text-xs font-semibold text-slate-400">类型数据（JSON）</span><Textarea bind:value={extraData} rows={10} class="font-mono text-xs" /><p class="text-xs text-muted-foreground">对象中的所有字符串都会在发送前逐字段加密。</p></div>
						{/if}

						<div class="space-y-3 border-t pt-4"><div class="flex items-center justify-between"><span class="text-xs font-semibold text-slate-400">自定义字段</span><Button type="button" size="xs" variant="ghost" onclick={() => customFields = [...customFields, { name: "", value: "", type: 0 }]}><Plus />添加</Button></div>{#each customFields as field, index}<div class="grid grid-cols-[1fr_1fr_auto] gap-2"><Input bind:value={field.name} placeholder="字段名" /><Input bind:value={field.value} type={field.type === 1 ? "password" : "text"} placeholder="字段值" /><Button type="button" variant="ghost" size="icon-sm" onclick={() => customFields = customFields.filter((_, itemIndex) => itemIndex !== index)} aria-label="删除字段"><Trash2 /></Button><select bind:value={field.type} aria-label="字段类型" class="col-span-2 rounded-md border bg-background px-2 py-1 text-xs"><option value={0}>文本</option><option value={1}>隐藏</option><option value={2}>布尔</option></select></div>{/each}</div>

						<!-- Identity Fields -->
						{#if editType === CipherType.Identity}
							<div class="space-y-4 border-t border-slate-200 dark:border-slate-850 pt-4">
								<div class="grid grid-cols-2 gap-2">
									<div class="space-y-1.5">
										<span class="text-xs font-semibold text-slate-400 font-bold">姓</span>
										<Input bind:value={lastName} placeholder="姓" />
									</div>
									<div class="space-y-1.5">
										<span class="text-xs font-semibold text-slate-400 font-bold">名</span>
										<Input bind:value={firstName} placeholder="名" />
									</div>
								</div>
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400 font-bold">证件号码</span>
									<Input bind:value={identityNumber} placeholder="身份证/护照等号码" />
								</div>
							</div>
						{/if}

						<!-- Notes (Notes is common for all) -->
						<div class="space-y-1.5 border-t border-slate-200 dark:border-slate-850 pt-4">
							<span class="text-xs font-semibold text-slate-400 font-bold">便签 / 备注</span>
							<textarea bind:value={editNotes} rows="4" placeholder="便签内容..." class="w-full p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-y"></textarea>
						</div>
					</div>

					<div class="flex gap-2 pt-2">
						<Button onclick={handleSaveCipher} class="flex-1 bg-primary text-primary-foreground font-semibold">
							保存
						</Button>
						{#if isEditing}
							<Button onclick={handleDeleteCipher} variant="ghost" class="text-red-500 hover:text-red-650 hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-200 dark:border-red-950">
								删除
							</Button>
						{/if}
					</div>
				</div>
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

<!-- 删除确认弹窗 -->
<AlertDialog.Root bind:open={deleteDialogOpen}>
	<AlertDialog.Portal>
		<AlertDialog.Overlay />
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>确认删除</AlertDialog.Title>
				<AlertDialog.Description>
					{selectedItem?.deletedDate ? `确定要永久删除“${selectedItem?.name}”吗？此操作无法撤销。` : `确定要将“${selectedItem?.name}”移到回收站吗？`}
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={deleteLoading}>取消</AlertDialog.Cancel>
				<AlertDialog.Action
					onclick={confirmDeleteCipher}
					disabled={deleteLoading}
					class="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
				>
					{#if deleteLoading}
						<div class="size-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5"></div>
					{/if}
					{selectedItem?.deletedDate ? "永久删除" : "移到回收站"}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteAllFoldersDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header><AlertDialog.Title>删除全部文件夹</AlertDialog.Title><AlertDialog.Description>将删除全部 {vault.folders.length} 个文件夹。保险库项目不会被删除，而会移至“无文件夹”。此操作不可撤销。</AlertDialog.Description></AlertDialog.Header>
		<AlertDialog.Footer><AlertDialog.Cancel disabled={deleteFolderLoading}>取消</AlertDialog.Cancel><AlertDialog.Action onclick={confirmDeleteAllFolders} disabled={deleteFolderLoading} class="bg-destructive text-white hover:bg-destructive/90">确认删除全部</AlertDialog.Action></AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={moveDialogOpen}><Dialog.Content><Dialog.Header><Dialog.Title>移动所选条目</Dialog.Title><Dialog.Description>选择目标文件夹；选择“无文件夹”会移出当前文件夹。</Dialog.Description></Dialog.Header><select bind:value={moveFolderId} class="h-9 rounded-md border bg-background px-3 text-sm"><option value={null}>无文件夹</option>{#each vault.folders as folder}<option value={folder.id}>{folder.name}</option>{/each}</select><Dialog.Footer><Button variant="outline" onclick={() => moveDialogOpen = false}>取消</Button><Button onclick={moveSelectedItems} disabled={deleteLoading}>移动 {selectedIdList.length} 项</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<!-- 文件夹创建/重命名弹窗 -->
<AlertDialog.Root bind:open={folderDialogOpen}>
	<AlertDialog.Portal>
		<AlertDialog.Overlay />
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>
					{folderDialogMode === 'create' ? '新建文件夹' : '重命名文件夹'}
				</AlertDialog.Title>
				<AlertDialog.Description>
					请输入文件夹的名称：
				</AlertDialog.Description>
			</AlertDialog.Header>
			<div class="py-4">
				<Input
					type="text"
					placeholder="文件夹名称"
					bind:value={folderDialogName}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							handleFolderSubmit();
						}
					}}
					class="w-full"
					autofocus
				/>
			</div>
			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={folderDialogLoading} onclick={() => { folderDialogOpen = false; }}>取消</AlertDialog.Cancel>
				<AlertDialog.Action
					onclick={handleFolderSubmit}
					disabled={folderDialogLoading || !folderDialogName.trim()}
					class="bg-primary text-white hover:bg-primary/90"
				>
					{#if folderDialogLoading}
						<div class="size-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5"></div>
					{/if}
					保存
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>

<!-- 文件夹删除确认弹窗 -->
<AlertDialog.Root bind:open={deleteFolderDialogOpen}>
	<AlertDialog.Portal>
		<AlertDialog.Overlay />
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>确认删除文件夹</AlertDialog.Title>
				<AlertDialog.Description>
					确定要删除文件夹「{targetFolder?.name}」吗？
					<p class="text-xs text-red-500 mt-2">注意：此操作仅删除文件夹本身，文件夹内的密码项不会被删除，它们将被移至未分类。</p>
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={deleteFolderLoading} onclick={() => { deleteFolderDialogOpen = false; }}>取消</AlertDialog.Cancel>
				<AlertDialog.Action
					onclick={confirmDeleteFolder}
					disabled={deleteFolderLoading}
					class="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
				>
					{#if deleteFolderLoading}
						<div class="size-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5"></div>
					{/if}
					确认删除
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
