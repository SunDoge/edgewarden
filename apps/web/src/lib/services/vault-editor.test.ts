import { CipherType } from "@edgewarden/shared";
import { describe, expect, it } from "vitest";
import { createVaultEditorForm, vaultCipherToEditorForm } from "./vault-editor";

describe("vault editor form", () => {
	it("creates a login draft in the active folder", () => {
		expect(createVaultEditorForm("folder-1")).toMatchObject({
			type: CipherType.Login,
			folderId: "folder-1",
			loginUris: [{ uri: "", match: null }],
			customFields: [],
		});
	});

	it("maps login and custom fields into an isolated editable draft", () => {
		const cipher = {
			type: CipherType.Login,
			name: "Example",
			favorite: true,
			collectionIds: ["collection-1"],
			login: {
				username: "alice",
				uris: [{ uri: "https://example.test", match: 0 }],
			},
			fields: [{ name: "PIN", value: "1234", type: "1" }],
		};
		const form = vaultCipherToEditorForm(cipher);
		expect(form).toMatchObject({
			name: "Example",
			favorite: true,
			loginUsername: "alice",
			loginUris: [{ uri: "https://example.test", match: 0 }],
			customFields: [{ name: "PIN", value: "1234", type: 1 }],
		});
		form.collectionIds.push("collection-2");
		expect(cipher.collectionIds).toEqual(["collection-1"]);
	});

	it("serializes modern cipher data as editable JSON", () => {
		const form = vaultCipherToEditorForm({
			type: CipherType.SshKey,
			name: "Server key",
			sshKey: { publicKey: "ssh-ed25519 AAAA" },
		});
		expect(JSON.parse(form.extraData)).toEqual({
			publicKey: "ssh-ed25519 AAAA",
		});
	});
});
