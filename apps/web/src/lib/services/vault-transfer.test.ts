import { describe, expect, it } from "vitest";
import { CipherType } from "@edgewarden/shared";
import { argon2id } from "hash-wasm";
import {
	decryptCipher,
	decryptStr,
	encryptBw,
	hkdfExpand,
	pbkdf2,
} from "./crypto";
import {
	buildBitwardenCsv,
	buildBitwardenJson,
	buildPlainExportDocument,
	deduplicateTransferDocument,
	encryptTransferDocument,
	parseVaultImport,
	parseVaultImportFile,
} from "./vault-transfer";

describe("vault import and export", () => {
	it("detects duplicate decrypted items despite different IDs and timestamps", () => {
		const existing = {
			folders: [{ id: "existing-folder", name: "Work" }],
			warnings: [],
			items: [
				{
					id: "existing-item",
					folderId: "existing-folder",
					revisionDate: "2026-08-12T00:00:00Z",
					type: CipherType.Login,
					name: "Example",
					login: { username: "alice", password: "secret" },
				},
			],
		};
		const incoming = {
			folders: [{ id: "import-folder", name: "Work" }],
			warnings: [],
			items: [
				{
					id: "import-item",
					folderId: "import-folder",
					creationDate: "2020-01-01T00:00:00Z",
					type: CipherType.Login,
					name: "Example",
					login: { password: "secret", username: "alice" },
				},
			],
		};

		const result = deduplicateTransferDocument(incoming, existing);
		expect(result.duplicateItems).toBe(1);
		expect(result.duplicateFolders).toBe(1);
		expect(result.document.items).toEqual([]);
		expect(result.document.folders).toEqual([]);
	});

	it("keeps changed secrets and folders needed by retained items", () => {
		const existing = {
			folders: [{ id: "old-folder", name: "Work" }],
			warnings: [],
			items: [
				{
					folderId: "old-folder",
					type: CipherType.Login,
					name: "Example",
					login: { username: "alice", password: "old" },
				},
			],
		};
		const incoming = {
			folders: [{ id: "new-folder", name: "Work" }],
			warnings: [],
			items: [
				{
					folderId: "new-folder",
					type: CipherType.Login,
					name: "Example",
					login: { username: "alice", password: "new" },
				},
			],
		};

		const result = deduplicateTransferDocument(incoming, existing);
		expect(result.duplicateItems).toBe(0);
		expect(result.document.items).toHaveLength(1);
		expect(result.document.folders).toEqual(incoming.folders);
	});

	it("keeps different accounts on the same website during import", () => {
		const existing = {
			folders: [],
			warnings: [],
			items: [
				{
					type: CipherType.Login,
					name: "GitHub",
					login: {
						username: "alice",
						password: "shared-password",
						uris: [{ uri: "https://github.com" }],
					},
				},
			],
		};
		const incoming = {
			folders: [],
			warnings: [],
			items: [
				{
					type: CipherType.Login,
					name: "GitHub",
					login: {
						username: "bob",
						password: "shared-password",
						uris: [{ uri: "https://github.com/login" }],
					},
				},
			],
		};

		const result = deduplicateTransferDocument(incoming, existing);
		expect(result.duplicateItems).toBe(0);
		expect(result.document.items).toEqual(incoming.items);
	});

	it("deduplicates repeated items inside a single import", () => {
		const item = {
			type: CipherType.SecureNote,
			name: "Recovery",
			notes: "codes",
			secureNote: { type: 0 },
		};
		const result = deduplicateTransferDocument(
			{ folders: [], warnings: [], items: [item, { ...item }] },
			{ folders: [], warnings: [], items: [] },
		);
		expect(result.duplicateItems).toBe(1);
		expect(result.document.items).toEqual([item]);
	});

	it("exports all type data without wrapped encryption keys or trashed items", () => {
		const items = [
			{
				id: "ssh",
				folderId: null,
				type: CipherType.SshKey,
				name: "SSH",
				notes: null,
				favorite: false,
				reprompt: 0,
				key: "2.sensitive-wrapped-key",
				sshKey: { privateKey: "plain-private" },
				fields: [{ name: "token", value: "plain" }],
				passwordHistory: null,
				deletedDate: null,
			},
			{
				id: "trash",
				folderId: null,
				type: CipherType.Login,
				name: "Trash",
				deletedDate: "2026-01-01",
			},
		] as any;
		const document = buildPlainExportDocument([], items);
		expect(document.items).toHaveLength(1);
		expect(document.items[0].sshKey.privateKey).toBe("plain-private");
		expect(JSON.stringify(document)).not.toContain("sensitive-wrapped-key");
		expect(document.items[0]).not.toHaveProperty("key");
	});

	it("parses quoted browser CSV fields and folder relationships", () => {
		const parsed = parseVaultImport(
			'name,url,username,password,folder,extra\r\n"Example, Inc",https://example.com,me,"p""ass",Work,"line 1\nline 2"',
			"csv",
		);
		expect(parsed.items[0].name).toBe("Example, Inc");
		expect(parsed.items[0].login.password).toBe('p"ass');
		expect(parsed.items[0].notes).toBe("line 1\nline 2");
		expect(parsed.folders[0].name).toBe("Work");
	});

	it("round-trips login values through Bitwarden-compatible CSV", () => {
		const source = {
			folders: [{ id: "f", name: "Work" }],
			warnings: [],
			items: [
				{
					folderId: "f",
					type: CipherType.Login,
					name: "Site",
					notes: "note",
					favorite: true,
					login: {
						username: "me",
						password: "secret",
						uri: "https://example.com",
						totp: "ABC",
					},
				},
			],
		};
		const parsed = parseVaultImport(buildBitwardenCsv(source), "csv");
		expect(parsed.items[0].login).toMatchObject({
			username: "me",
			password: "secret",
			uri: "https://example.com",
		});
	});

	it("parses Bitwarden CSV secure notes without turning them into logins", () => {
		const parsed = parseVaultImport(
			"folder,favorite,type,name,notes\r\n,0,note,Recovery,offline codes",
			"csv",
		);
		expect(parsed.items[0]).toMatchObject({
			type: CipherType.SecureNote,
			secureNote: { type: 0 },
			notes: "offline codes",
		});
		expect(parsed.items[0]).not.toHaveProperty("login");
	});

	it("exports non-login types as Bitwarden-compatible notes", () => {
		const csv = buildBitwardenCsv({
			folders: [],
			warnings: [],
			items: [
				{ type: CipherType.Card, name: "Visa", card: { number: "4111" } },
			],
		});
		expect(csv).toContain(",note,Visa,");
		expect(csv).not.toContain(`,${CipherType.Card},`);
		expect(parseVaultImport(csv, "csv").items[0].type).toBe(
			CipherType.SecureNote,
		);
	});

	it("emits canonical unencrypted Bitwarden JSON and rejects encrypted exports", () => {
		const json = buildBitwardenJson({
			folders: [],
			items: [{ type: 1, name: "Site" }],
			warnings: ["internal warning"],
		});
		expect(JSON.parse(json)).toEqual({
			encrypted: false,
			folders: [],
			items: [{ type: 1, name: "Site" }],
		});
		expect(() => parseVaultImport('{"encrypted":true,"items":[]}')).toThrow(
			/账户限制型加密 JSON/,
		);
	});

	it("decrypts password-protected Bitwarden JSON and preserves stored passkeys", async () => {
		const password = "correct horse battery staple";
		const salt = "base64-export-salt";
		const iterations = 100_000;
		const material = await pbkdf2(password, salt, iterations, 32);
		const encKey = await hkdfExpand(material, "enc", 32);
		const macKey = await hkdfExpand(material, "mac", 32);
		const clearText = JSON.stringify({
			encrypted: false,
			folders: [{ id: "folder", name: "Passkeys" }],
			items: [
				{
					id: "item",
					folderId: "folder",
					type: CipherType.Login,
					name: "Example",
					login: {
						username: "alice",
						fido2Credentials: [
							{
								credentialId: "credential-id",
								keyValue: "private-key",
								rpId: "example.com",
							},
						],
					},
				},
			],
		});
		const document = JSON.stringify({
			encrypted: true,
			passwordProtected: true,
			salt,
			kdfType: 0,
			kdfIterations: iterations,
			encKeyValidation_DO_NOT_EDIT: await encryptBw(
				new TextEncoder().encode("validation"),
				encKey,
				macKey,
			),
			data: await encryptBw(
				new TextEncoder().encode(clearText),
				encKey,
				macKey,
			),
		});

		const imported = await parseVaultImportFile(document, "json", password);
		expect(imported.folders).toEqual([{ id: "folder", name: "Passkeys" }]);
		expect(imported.items[0].login.fido2Credentials[0]).toMatchObject({
			credentialId: "credential-id",
			keyValue: "private-key",
			rpId: "example.com",
		});
		await expect(
			parseVaultImportFile(document, "json", "wrong password"),
		).rejects.toThrow(/密码错误|已损坏/);
	});

	it("decrypts Bitwarden password-protected exports using Argon2id parameters", async () => {
		const password = "argon export password";
		const salt = "argon-export-salt";
		const material = await argon2id({
			password,
			salt,
			iterations: 2,
			parallelism: 1,
			memorySize: 8 * 1024,
			hashLength: 32,
			outputType: "binary",
		});
		const encKey = await hkdfExpand(material, "enc", 32);
		const macKey = await hkdfExpand(material, "mac", 32);
		const clearText = JSON.stringify({
			encrypted: false,
			folders: [],
			items: [{ type: 1, name: "Argon item" }],
		});
		const document = JSON.stringify({
			encrypted: true,
			passwordProtected: true,
			salt,
			kdfType: 1,
			kdfIterations: 2,
			kdfMemory: 8,
			kdfParallelism: 1,
			encKeyValidation_DO_NOT_EDIT: await encryptBw(
				new TextEncoder().encode("validation"),
				encKey,
				macKey,
			),
			data: await encryptBw(
				new TextEncoder().encode(clearText),
				encKey,
				macKey,
			),
		});
		expect(
			(await parseVaultImportFile(document, "json", password)).items[0].name,
		).toBe("Argon item");
	});

	it("encrypts every sensitive import value before building the API payload", async () => {
		const encKey = crypto.getRandomValues(new Uint8Array(32));
		const macKey = crypto.getRandomValues(new Uint8Array(32));
		const payload = await encryptTransferDocument(
			{
				folders: [{ id: "folder-1", name: "Secret folder" }],
				warnings: [],
				items: [
					{
						folderId: "folder-1",
						type: CipherType.Login,
						name: "Bank",
						notes: "private",
						favorite: false,
						reprompt: 0,
						login: {
							username: "alice",
							password: "hunter2",
							uris: [{ uri: "https://bank.test", match: null }],
							fido2Credentials: [
								{
									credentialId: "credential-id",
									keyType: "public-key",
									keyAlgorithm: "ECDSA",
									keyCurve: "P-256",
									keyValue: "private-passkey-material",
									rpId: "bank.test",
									rpName: "Bank",
									userHandle: "user-handle",
									userName: "alice",
									counter: "0",
									discoverable: "true",
									creationDate: "2026-08-11T00:00:00.000Z",
								},
							],
						},
					},
				],
			},
			encKey,
			macKey,
		);
		const serialized = JSON.stringify(payload);
		for (const secret of [
			"Secret folder",
			"Bank",
			"private",
			"alice",
			"hunter2",
			"bank.test",
			"credential-id",
			"private-passkey-material",
			"user-handle",
		])
			expect(serialized).not.toContain(secret);
		expect(await decryptStr(payload.folders[0].name, encKey, macKey)).toBe(
			"Secret folder",
		);
		const decrypted = await decryptCipher(
			payload.ciphers[0] as any,
			encKey,
			macKey,
		);
		expect(decrypted).toMatchObject({
			name: "Bank",
			notes: "private",
			login: {
				username: "alice",
				password: "hunter2",
				fido2Credentials: [
					{
						credentialId: "credential-id",
						keyValue: "private-passkey-material",
						rpId: "bank.test",
						userHandle: "user-handle",
					},
				],
			},
		});
		expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
	});
});
