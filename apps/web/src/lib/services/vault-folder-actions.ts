import {
	createFolderApi,
	deleteFolderApi,
	deleteFoldersApi,
	updateFolderApi,
} from "$lib/services/api";
import { encryptStr } from "$lib/services/crypto";

export type FolderEditorMode = "create" | "rename";

export async function saveVaultFolder({
	mode,
	name,
	folderId,
	encKey,
	macKey,
}: {
	mode: FolderEditorMode;
	name: string;
	folderId?: string;
	encKey?: Uint8Array | null;
	macKey?: Uint8Array | null;
}) {
	const normalizedName = name.trim();
	if (!normalizedName) return;
	if (!encKey || !macKey) throw new Error("密钥未就绪，请重新解锁保险库");
	const encryptedName = await encryptStr(normalizedName, encKey, macKey);
	if (mode === "create") await createFolderApi({ name: encryptedName });
	else if (folderId) await updateFolderApi(folderId, { name: encryptedName });
	else throw new Error("找不到要重命名的文件夹");
}

export async function removeVaultFolder(folderId: string) {
	await deleteFolderApi(folderId);
}

export async function removeAllVaultFolders(folders: Array<{ id: string }>) {
	if (folders.length) await deleteFoldersApi(folders.map((folder) => folder.id));
}
