import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	remove: vi.fn(),
	removeMany: vi.fn(),
	update: vi.fn(),
	encrypt: vi.fn(),
}));

vi.mock("./api", () => ({
	createFolderApi: mocks.create,
	deleteFolderApi: mocks.remove,
	deleteFoldersApi: mocks.removeMany,
	updateFolderApi: mocks.update,
}));
vi.mock("./crypto", () => ({ encryptStr: mocks.encrypt }));

import {
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
		expect(mocks.encrypt).toHaveBeenCalledWith("Work", keys.encKey, keys.macKey);
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
});
