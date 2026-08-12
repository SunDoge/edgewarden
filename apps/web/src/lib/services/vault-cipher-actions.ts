import type { VaultEditorForm } from "$lib/services/vault-editor";
import {
	archiveCipherApi,
	archiveCiphersApi,
	createCipherApi,
	deleteCipherApi,
	deleteCiphersApi,
	hardDeleteCipherApi,
	hardDeleteCiphersApi,
	restoreCipherApi,
	restoreCiphersApi,
	unarchiveCipherApi,
	unarchiveCiphersApi,
	updateCipherApi,
} from "$lib/services/api";
import { encryptCipher } from "$lib/services/cipher-crypto";
import { buildCipherPayload } from "$lib/services/cipher-draft";

export type CipherOwnerKey = { encKey: Uint8Array; macKey: Uint8Array };
export type CipherOwnerKeyResolver = (organizationId?: string | null) => CipherOwnerKey | null;
export type VaultBulkAction = "delete" | "restore" | "permanent" | "archive" | "unarchive";

export async function saveVaultCipher({
	editor,
	selectedItem,
	isCreating,
	isEditing,
	resolveOwnerKey,
}: {
	editor: VaultEditorForm;
	selectedItem: any | null;
	isCreating: boolean;
	isEditing: boolean;
	resolveOwnerKey: CipherOwnerKeyResolver;
}) {
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
	if (editor.organizationId && !editor.collectionIds.length) {
		throw new Error("组织条目至少需要选择一个集合");
	}
	const ownerKey = resolveOwnerKey(editor.organizationId);
	if (!ownerKey) throw new Error("密钥未就绪，请重新解锁保险库");
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
	if (isCreating) await createCipherApi(encryptedPayload);
	else if (isEditing && selectedItem) await updateCipherApi(selectedItem.id, encryptedPayload);
}

export async function updateEncryptedVaultCipher(
	item: any,
	changes: Record<string, unknown>,
	resolveOwnerKey: CipherOwnerKeyResolver,
) {
	if (item.readOnly) throw new Error("该组织条目为只读");
	const ownerKey = resolveOwnerKey(item.organizationId);
	if (!ownerKey) throw new Error("保险库密钥不可用");
	const encrypted = await encryptCipher(
		{ ...item, ...changes },
		ownerKey.encKey,
		ownerKey.macKey,
	);
	await updateCipherApi(item.id, encrypted);
}

const bulkPersonalActions = {
	delete: deleteCiphersApi,
	restore: restoreCiphersApi,
	permanent: hardDeleteCiphersApi,
	archive: archiveCiphersApi,
	unarchive: unarchiveCiphersApi,
} satisfies Record<VaultBulkAction, (ids: string[]) => Promise<unknown>>;

const singleCipherActions = {
	delete: deleteCipherApi,
	restore: restoreCipherApi,
	permanent: hardDeleteCipherApi,
	archive: archiveCipherApi,
	unarchive: unarchiveCipherApi,
} satisfies Record<VaultBulkAction, (id: string) => Promise<unknown>>;

export async function applyVaultBulkAction(action: VaultBulkAction, items: any[]) {
	if (items.some((item) => item.readOnly)) {
		throw new Error("选择中包含只读组织条目");
	}
	const personalIds = items
		.filter((item) => !item.organizationId)
		.map((item) => item.id);
	if (personalIds.length) await bulkPersonalActions[action](personalIds);
	for (const item of items.filter((cipher) => cipher.organizationId)) {
		await singleCipherActions[action](item.id);
	}
}
