import { describe, expect, it } from "vitest";
import { CipherType } from "@edgewarden/shared";
import { decryptCipher, decryptStr } from "./crypto";
import { buildBitwardenCsv, buildBitwardenJson, buildPlainExportDocument, encryptTransferDocument, parseVaultImport } from "./vault-transfer";

describe("vault import and export", () => {
	it("exports all type data without wrapped encryption keys or trashed items", () => {
		const items = [
			{ id: "ssh", folderId: null, type: CipherType.SshKey, name: "SSH", notes: null, favorite: false, reprompt: 0, key: "2.sensitive-wrapped-key", sshKey: { privateKey: "plain-private" }, fields: [{ name: "token", value: "plain" }], passwordHistory: null, deletedDate: null },
			{ id: "trash", folderId: null, type: CipherType.Login, name: "Trash", deletedDate: "2026-01-01" },
		] as any;
		const document = buildPlainExportDocument([], items);
		expect(document.items).toHaveLength(1);
		expect(document.items[0].sshKey.privateKey).toBe("plain-private");
		expect(JSON.stringify(document)).not.toContain("sensitive-wrapped-key");
		expect(document.items[0]).not.toHaveProperty("key");
	});

	it("parses quoted browser CSV fields and folder relationships", () => {
		const parsed = parseVaultImport('name,url,username,password,folder,extra\r\n"Example, Inc",https://example.com,me,"p""ass",Work,"line 1\nline 2"', "csv");
		expect(parsed.items[0].name).toBe("Example, Inc");
		expect(parsed.items[0].login.password).toBe('p"ass');
		expect(parsed.items[0].notes).toBe("line 1\nline 2");
		expect(parsed.folders[0].name).toBe("Work");
	});

	it("round-trips login values through Bitwarden-compatible CSV", () => {
		const source = { folders: [{ id: "f", name: "Work" }], warnings: [], items: [{ folderId: "f", type: CipherType.Login, name: "Site", notes: "note", favorite: true, login: { username: "me", password: "secret", uri: "https://example.com", totp: "ABC" } }] };
		const parsed = parseVaultImport(buildBitwardenCsv(source), "csv");
		expect(parsed.items[0].login).toMatchObject({ username: "me", password: "secret", uri: "https://example.com" });
	});

	it("parses Bitwarden CSV secure notes without turning them into logins", () => {
		const parsed = parseVaultImport("folder,favorite,type,name,notes\r\n,0,note,Recovery,offline codes", "csv");
		expect(parsed.items[0]).toMatchObject({ type: CipherType.SecureNote, secureNote: { type: 0 }, notes: "offline codes" });
		expect(parsed.items[0]).not.toHaveProperty("login");
	});

	it("exports non-login types as Bitwarden-compatible notes", () => {
		const csv = buildBitwardenCsv({ folders: [], warnings: [], items: [{ type: CipherType.Card, name: "Visa", card: { number: "4111" } }] });
		expect(csv).toContain(",note,Visa,");
		expect(csv).not.toContain(`,${CipherType.Card},`);
		expect(parseVaultImport(csv, "csv").items[0].type).toBe(CipherType.SecureNote);
	});

	it("emits canonical unencrypted Bitwarden JSON and rejects encrypted exports", () => {
		const json = buildBitwardenJson({ folders: [], items: [{ type: 1, name: "Site" }], warnings: ["internal warning"] });
		expect(JSON.parse(json)).toEqual({ encrypted: false, folders: [], items: [{ type: 1, name: "Site" }] });
		expect(() => parseVaultImport('{"encrypted":true,"items":[]}')).toThrow(/不支持.*加密 JSON/);
	});

	it("encrypts every sensitive import value before building the API payload", async () => {
		const encKey = crypto.getRandomValues(new Uint8Array(32));
		const macKey = crypto.getRandomValues(new Uint8Array(32));
		const payload = await encryptTransferDocument({
			folders: [{ id: "folder-1", name: "Secret folder" }], warnings: [],
			items: [{ folderId: "folder-1", type: CipherType.Login, name: "Bank", notes: "private", favorite: false, reprompt: 0, login: { username: "alice", password: "hunter2", uris: [{ uri: "https://bank.test", match: null }] } }],
		}, encKey, macKey);
		const serialized = JSON.stringify(payload);
		for (const secret of ["Secret folder", "Bank", "private", "alice", "hunter2", "bank.test"]) expect(serialized).not.toContain(secret);
		expect(await decryptStr(payload.folders[0].name, encKey, macKey)).toBe("Secret folder");
		const decrypted = await decryptCipher(payload.ciphers[0] as any, encKey, macKey);
		expect(decrypted).toMatchObject({ name: "Bank", notes: "private", login: { username: "alice", password: "hunter2" } });
		expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
	});
});
