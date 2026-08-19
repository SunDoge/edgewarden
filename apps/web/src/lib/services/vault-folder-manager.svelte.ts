import { toast } from "svelte-sonner";
import {
	removeAllVaultFolders,
	removeVaultFolder,
	saveVaultFolder,
	type FolderEditorMode,
} from "./vault-folder-actions";
import type { VaultFolder } from "./vault-types";
import { errorDetail } from "./error-message";
import { syncVaultData, vault } from "$lib/stores/vault.svelte";

export function createVaultFolderManager(activeFolder: {
	get(): string | null;
	set(value: string | null): void;
}) {
	let dialogOpen = $state(false);
	let dialogMode = $state<FolderEditorMode>("create");
	let dialogName = $state("");
	let dialogLoading = $state(false);
	let target = $state<VaultFolder | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteLoading = $state(false);
	let deleteAllDialogOpen = $state(false);

	return {
		get dialogOpen() {
			return dialogOpen;
		},
		set dialogOpen(value) {
			dialogOpen = value;
		},
		get dialogMode() {
			return dialogMode;
		},
		get dialogName() {
			return dialogName;
		},
		set dialogName(value) {
			dialogName = value;
		},
		get dialogLoading() {
			return dialogLoading;
		},
		get target() {
			return target;
		},
		get deleteDialogOpen() {
			return deleteDialogOpen;
		},
		set deleteDialogOpen(value) {
			deleteDialogOpen = value;
		},
		get deleteLoading() {
			return deleteLoading;
		},
		get deleteAllDialogOpen() {
			return deleteAllDialogOpen;
		},
		set deleteAllDialogOpen(value) {
			deleteAllDialogOpen = value;
		},
		openCreate() {
			dialogMode = "create";
			dialogName = "";
			target = null;
			dialogOpen = true;
		},
		openRename(folder: VaultFolder) {
			dialogMode = "rename";
			dialogName = folder.name;
			target = folder;
			dialogOpen = true;
		},
		openDelete(folder: VaultFolder) {
			target = folder;
			deleteDialogOpen = true;
		},
		async save() {
			if (!dialogName.trim()) return;
			dialogLoading = true;
			try {
				await saveVaultFolder({
					mode: dialogMode,
					name: dialogName,
					folderId: target?.id,
					encKey: vault.symEncKey,
					macKey: vault.symMacKey,
				});
				await syncVaultData();
				dialogOpen = false;
			} catch (caught) {
				toast.error(`操作文件夹失败: ${errorDetail(caught)}`);
			} finally {
				dialogLoading = false;
			}
		},
		async remove() {
			if (!target) return;
			deleteLoading = true;
			try {
				await removeVaultFolder(target.id);
				if (activeFolder.get() === target.id) activeFolder.set(null);
				await syncVaultData();
				deleteDialogOpen = false;
			} catch (caught) {
				toast.error(`删除文件夹失败: ${errorDetail(caught)}`);
			} finally {
				deleteLoading = false;
			}
		},
		async removeAll() {
			if (!vault.folders.length) return;
			deleteLoading = true;
			try {
				await removeAllVaultFolders(vault.folders);
				activeFolder.set(null);
				await syncVaultData();
				deleteAllDialogOpen = false;
			} catch (caught) {
				toast.error(`删除全部文件夹失败: ${errorDetail(caught)}`);
			} finally {
				deleteLoading = false;
			}
		},
	};
}
