import { toast } from "svelte-sonner";
import {
	applyVaultBulkAction,
	updateEncryptedVaultCipher,
	type CipherOwnerKeyResolver,
	type VaultBulkAction,
} from "./vault-cipher-actions";
import {
	findRedundantDuplicateCipherIds,
	type DuplicateMode,
} from "./vault-filter";
import type { VaultCipher } from "./vault-types";
import { errorDetail } from "./error-message";
import { syncVaultData, vault } from "$lib/stores/vault.svelte";

export function createVaultBulkManager(options: {
	duplicateMode(): DuplicateMode;
	clearSelectedItem(): void;
	confirm(action: VaultBulkAction): void;
	resolveOwnerKey: CipherOwnerKeyResolver;
}) {
	let selectedIds = $state<Record<string, boolean>>({});
	let moveDialogOpen = $state(false);
	let moveFolderId = $state<string | null>(null);
	let busy = $state(false);
	const selectedIdList = $derived(
		Object.keys(selectedIds).filter((id) => selectedIds[id]),
	);

	function clear() {
		selectedIds = {};
	}

	async function execute(action: VaultBulkAction) {
		const items = selectedIdList
			.map((id) => vault.ciphers.find((cipher) => cipher.id === id))
			.filter((item): item is VaultCipher => item !== undefined);
		busy = true;
		try {
			await applyVaultBulkAction(action, items);
			clear();
			options.clearSelectedItem();
			await syncVaultData();
		} catch (caught) {
			toast.error(`批量操作失败：${errorDetail(caught)}`);
		} finally {
			busy = false;
		}
	}

	return {
		get selectedIds() {
			return selectedIds;
		},
		get selectedIdList() {
			return selectedIdList;
		},
		get count() {
			return selectedIdList.length;
		},
		get moveDialogOpen() {
			return moveDialogOpen;
		},
		set moveDialogOpen(value) {
			moveDialogOpen = value;
		},
		get moveFolderId() {
			return moveFolderId;
		},
		set moveFolderId(value) {
			moveFolderId = value;
		},
		get busy() {
			return busy;
		},
		toggle(id: string) {
			selectedIds = { ...selectedIds, [id]: !selectedIds[id] };
		},
		clear,
		selectRedundant() {
			selectedIds = Object.fromEntries(
				[
					...findRedundantDuplicateCipherIds(
						vault.ciphers,
						options.duplicateMode(),
					),
				].map((id) => [id, true]),
			);
		},
		async run(action: VaultBulkAction) {
			if (!selectedIdList.length) return;
			if (action === "delete" || action === "permanent") {
				options.confirm(action);
				return;
			}
			await execute(action);
		},
		execute,
		openMove() {
			moveFolderId = null;
			moveDialogOpen = true;
		},
		async move() {
			busy = true;
			try {
				for (const id of selectedIdList) {
					const item = vault.ciphers.find((cipher) => cipher.id === id);
					if (item?.organizationId)
						throw new Error("组织条目使用集合，不能移动到个人文件夹");
					if (item && !item.deletedDate)
						await updateEncryptedVaultCipher(
							item,
							{ folderId: moveFolderId },
							options.resolveOwnerKey,
						);
				}
				moveDialogOpen = false;
				clear();
				await syncVaultData();
			} catch (caught) {
				toast.error(`移动失败：${errorDetail(caught)}`);
			} finally {
				busy = false;
			}
		},
	};
}
