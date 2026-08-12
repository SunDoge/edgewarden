import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	archiveOne: vi.fn(),
	archiveMany: vi.fn(),
	create: vi.fn(),
	deleteOne: vi.fn(),
	deleteMany: vi.fn(),
	permanentOne: vi.fn(),
	permanentMany: vi.fn(),
	restoreOne: vi.fn(),
	restoreMany: vi.fn(),
	unarchiveOne: vi.fn(),
	unarchiveMany: vi.fn(),
	update: vi.fn(),
}));

vi.mock("./api", () => ({
	archiveCipherApi: api.archiveOne,
	archiveCiphersApi: api.archiveMany,
	createCipherApi: api.create,
	deleteCipherApi: api.deleteOne,
	deleteCiphersApi: api.deleteMany,
	hardDeleteCipherApi: api.permanentOne,
	hardDeleteCiphersApi: api.permanentMany,
	restoreCipherApi: api.restoreOne,
	restoreCiphersApi: api.restoreMany,
	unarchiveCipherApi: api.unarchiveOne,
	unarchiveCiphersApi: api.unarchiveMany,
	updateCipherApi: api.update,
}));

vi.mock("./cipher-crypto", () => ({ encryptCipher: vi.fn() }));
vi.mock("./cipher-draft", () => ({ buildCipherPayload: vi.fn() }));

import { applyVaultBulkAction } from "./vault-cipher-actions";

describe("vault cipher actions", () => {
	beforeEach(() => vi.clearAllMocks());

	it("uses the batch API for personal ciphers and single APIs for organizations", async () => {
		await applyVaultBulkAction("archive", [
			{ id: "personal-1", organizationId: null },
			{ id: "personal-2" },
			{ id: "organization-1", organizationId: "org-1" },
		]);

		expect(api.archiveMany).toHaveBeenCalledWith(["personal-1", "personal-2"]);
		expect(api.archiveOne).toHaveBeenCalledWith("organization-1");
	});

	it("rejects a selection containing read-only organization ciphers", async () => {
		await expect(
			applyVaultBulkAction("delete", [
				{ id: "organization-1", organizationId: "org-1", readOnly: true },
			]),
		).rejects.toThrow("选择中包含只读组织条目");

		expect(api.deleteMany).not.toHaveBeenCalled();
		expect(api.deleteOne).not.toHaveBeenCalled();
	});

	it.each([
		["delete", api.deleteMany, api.deleteOne],
		["restore", api.restoreMany, api.restoreOne],
		["permanent", api.permanentMany, api.permanentOne],
		["unarchive", api.unarchiveMany, api.unarchiveOne],
	] as const)("routes the %s action to matching APIs", async (action, many, one) => {
		await applyVaultBulkAction(action, [
			{ id: "personal" },
			{ id: "organization", organizationId: "org-1" },
		]);
		expect(many).toHaveBeenCalledWith(["personal"]);
		expect(one).toHaveBeenCalledWith("organization");
	});
});
