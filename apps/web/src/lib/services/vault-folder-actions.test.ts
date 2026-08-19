import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	remove: vi.fn(),
	removeMany: vi.fn(),
	move: vi.fn(),
	update: vi.fn(),
	encrypt: vi.fn(),
}));

vi.mock("./api-folders", () => ({
	createFolderApi: mocks.create,
	deleteFolderApi: mocks.remove,
	deleteFoldersApi: mocks.removeMany,
	updateFolderApi: mocks.update,
}));

vi.mock("./api-vault", () => ({
	moveCiphersApi: mocks.move,
}));
vi.mock("./crypto", () => ({ encryptStr: mocks.encrypt }));

import {
	findDuplicateFolderGroups,
	mergeDuplicateVaultFolders,
	removeAllVaultFolders,
	saveVaultFolder,
} from "./vault-folder-actions";

const keys = {
	encKey: new Uint8Array([1]),
	macKey: new Uint8Array([2]),
};

describe("vault folder actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.encrypt.mockResolvedValue("encrypted-name");
	});

	it("normalizes and encrypts a new folder name", async () => {
		await saveVaultFolder({ mode: "create", name: " Work ", ...keys });
		expect(mocks.encrypt).toHaveBeenCalledWith(
			"Work",
			keys.encKey,
			keys.macKey,
		);
		expect(mocks.create).toHaveBeenCalledWith({ name: "encrypted-name" });
	});

	it("updates the selected folder without creating another", async () => {
		await saveVaultFolder({
			mode: "rename",
			name: "Personal",
			folderId: "folder-1",
			...keys,
		});
		expect(mocks.update).toHaveBeenCalledWith("folder-1", {
			name: "encrypted-name",
		});
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("requires encryption keys before writing", async () => {
		await expect(
			saveVaultFolder({ mode: "create", name: "Work" }),
		).rejects.toThrow("密钥未就绪");
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("deletes all folder ids in a single request", async () => {
		await removeAllVaultFolders([{ id: "a" }, { id: "b" }]);
		expect(mocks.removeMany).toHaveBeenCalledWith(["a", "b"]);
	});

	it("merges same-name folders into the newest folder without deleting items", async () => {
		const folders = [
			{ id: "old", name: "Work", revisionDate: "2026-01-01T00:00:00Z" },
			{ id: "new", name: "Work", revisionDate: "2026-02-01T00:00:00Z" },
			{ id: "other", name: "Personal" },
		];
		expect(findDuplicateFolderGroups(folders)).toEqual([
			[folders[0], folders[1]],
		]);

		const result = await mergeDuplicateVaultFolders(folders, [
			{ id: "cipher", folderId: "old", deletedDate: null },
			{ id: "trash", folderId: "old", deletedDate: "2026-01-01" },
		]);

		expect(mocks.move).toHaveBeenCalledWith(["cipher"], "new");
		expect(mocks.removeMany).toHaveBeenCalledWith(["old"]);
		expect(result).toEqual({ mergedFolders: 1, movedItems: 1 });
	});
});
