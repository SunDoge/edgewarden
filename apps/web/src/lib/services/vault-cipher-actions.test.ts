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
const cipher = vi.hoisted(() => ({
  buildPayload: vi.fn(),
  encrypt: vi.fn(),
}));
const attachments = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("./api-vault", () => ({
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

vi.mock("./cipher-crypto", () => ({ encryptCipher: cipher.encrypt }));
vi.mock("./cipher-draft", () => ({ buildCipherPayload: cipher.buildPayload }));
vi.mock("./vault-editor", () => ({
  vaultCipherToEditorForm: vi.fn(() => ({
    type: 1,
    name: "Shared",
    notes: "",
    favorite: false,
    loginUsername: "member",
    loginPassword: "secret",
    loginUri: "",
    loginUris: [],
    loginTotp: "",
    cardholderName: "",
    cardNumber: "",
    firstName: "",
    lastName: "",
    identityNumber: "",
    customFields: [],
    extraData: "{}",
  })),
}));
vi.mock("./vault-attachments", () => ({
  downloadVaultAttachment: attachments.download,
  uploadVaultAttachment: attachments.upload,
}));

import {
  applyVaultBulkAction,
  cloneVaultCipherToPersonal,
  saveVaultCipher,
} from "./vault-cipher-actions";

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

  it("returns the server acknowledgement for a saved cipher", async () => {
    const encrypted = { type: 1, name: "encrypted" };
    const acknowledgement = {
      id: "cipher-1",
      revisionDate: "2026-08-13T01:00:00.000Z",
    };
    cipher.buildPayload.mockReturnValue({ type: 1, name: "plain" });
    cipher.encrypt.mockResolvedValue(encrypted);
    api.create.mockResolvedValue(acknowledgement);

    await expect(
      saveVaultCipher({
        editor: {
          type: 1,
          name: "plain",
          organizationId: null,
          collectionIds: [],
        } as never,
        selectedItem: null,
        isCreating: true,
        isEditing: false,
        resolveOwnerKey: () => ({
          encKey: new Uint8Array(32),
          macKey: new Uint8Array(32),
        }),
      }),
    ).resolves.toBe(acknowledgement);
    expect(api.create).toHaveBeenCalledWith(encrypted);
  });

  it("clones an organization cipher and its attachments into the personal vault", async () => {
    cipher.buildPayload.mockReturnValue({ type: 1, name: "Shared" });
    cipher.encrypt.mockResolvedValue({
      type: 1,
      name: "encrypted",
      organizationId: null,
    });
    api.create.mockResolvedValue({ id: "personal-copy", key: "personal-key" });
    attachments.download.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "secret.txt",
    });
    const personalKeys = {
      encKey: new Uint8Array(32),
      macKey: new Uint8Array(32),
    };

    await cloneVaultCipherToPersonal(
      {
        id: "organization-item",
        organizationId: "org-1",
        attachments: [{ id: "attachment-1" }],
      } as never,
      personalKeys,
    );

    expect(cipher.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        key: null,
        organizationId: null,
        collectionIds: [],
      }),
      personalKeys.encKey,
      personalKeys.macKey,
    );
    expect(attachments.download).toHaveBeenCalledWith(
      "organization-item",
      expect.objectContaining({ id: "attachment-1" }),
    );
    expect(attachments.upload).toHaveBeenCalledWith(
      expect.objectContaining({ id: "personal-copy" }),
      expect.objectContaining({ name: "secret.txt" }),
      personalKeys,
    );
  });

  it.each([
    ["delete", api.deleteMany, api.deleteOne],
    ["restore", api.restoreMany, api.restoreOne],
    ["permanent", api.permanentMany, api.permanentOne],
    ["unarchive", api.unarchiveMany, api.unarchiveOne],
  ] as const)(
    "routes the %s action to matching APIs",
    async (action, many, one) => {
      await applyVaultBulkAction(action, [
        { id: "personal" },
        { id: "organization", organizationId: "org-1" },
      ]);
      expect(many).toHaveBeenCalledWith(["personal"]);
      expect(one).toHaveBeenCalledWith("organization");
    },
  );
});
