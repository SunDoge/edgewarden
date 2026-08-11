import { CipherType, type CipherImportInput, type CipherResponse, type FolderResponse } from "@edgewarden/shared";
import { encryptCipher, encryptStr } from "./crypto";

export interface TransferDocument {
	folders: Array<{ id?: string; name: string }>;
	items: Array<Record<string, any>>;
	warnings: string[];
}

export interface EncryptedImportPayload {
	folders: Array<{ name: string }>;
	ciphers: NonNullable<CipherImportInput["ciphers"]>;
	folderRelationships: Array<{ key: number; value: number }>;
}

const TYPE_KEYS: Record<number, string> = {
	[CipherType.Login]: "login",
	[CipherType.SecureNote]: "secureNote",
	[CipherType.Card]: "card",
	[CipherType.Identity]: "identity",
	[CipherType.SshKey]: "sshKey",
	[CipherType.BankAccount]: "bankAccount",
	[CipherType.DriversLicense]: "driversLicense",
	[CipherType.Passport]: "passport",
};

export function buildPlainExportDocument(
	folders: FolderResponse[],
	ciphers: CipherResponse[],
): TransferDocument {
	return {
		folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
		items: ciphers.filter((cipher) => !cipher.deletedDate).map((cipher: any) => {
			const item: Record<string, any> = {
				id: cipher.id,
				folderId: cipher.folderId,
				type: cipher.type,
				name: cipher.name,
				notes: cipher.notes,
				favorite: cipher.favorite,
				reprompt: cipher.reprompt,
				fields: cipher.fields,
				passwordHistory: cipher.passwordHistory,
			};
			const key = TYPE_KEYS[cipher.type];
			if (key) item[key] = cipher[key] ?? (key === "secureNote" ? {} : null);
			return item;
		}),
		warnings: [],
	};
}

function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
			else if (char === '"') quoted = false;
			else field += char;
		} else if (char === '"') quoted = true;
		else if (char === ",") { row.push(field); field = ""; }
		else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
		else field += char;
	}
	if (quoted) throw new Error("CSV 引号未闭合");
	if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
	return rows.filter((entry) => entry.some((value) => value.trim()));
}

function first(record: Record<string, string>, names: string[]): string {
	for (const name of names) if (record[name] != null) return record[name];
	return "";
}

function parseCsv(text: string): TransferDocument {
	const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
	if (rows.length < 2) throw new Error("CSV 中没有可导入的数据");
	const headers = rows[0].map((value) => value.trim().toLowerCase().replace(/[ _-]+/g, ""));
	const folders: Array<{ id: string; name: string }> = [];
	const folderIds = new Map<string, string>();
	const warnings: string[] = [];
	const items = rows.slice(1).map((values, rowIndex) => {
		const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
		const name = first(record, ["name", "title", "sitename", "account"]).trim() || `Imported item ${rowIndex + 1}`;
		const username = first(record, ["loginusername", "username", "user", "email"]);
		const password = first(record, ["loginpassword", "password", "pass"]);
		const uri = first(record, ["loginuri", "url", "website", "hostname"]);
		const notes = first(record, ["notes", "extra", "comment"]);
		const folderName = first(record, ["folder", "group", "grouping"]).trim();
		let folderId: string | null = null;
		if (folderName) {
			folderId = folderIds.get(folderName) ?? `csv-folder-${folderIds.size}`;
			if (!folderIds.has(folderName)) { folderIds.set(folderName, folderId); folders.push({ id: folderId, name: folderName }); }
		}
		if (!username && !password && !uri && !notes) warnings.push(`第 ${rowIndex + 2} 行缺少常见登录字段`);
		const common = { name, notes: notes || null, favorite: /^(1|true|yes)$/i.test(first(record, ["favorite"])), reprompt: Number(first(record, ["reprompt"])) || 0, folderId };
		if (first(record, ["type"]).trim().toLowerCase() === "note") {
			return { ...common, type: CipherType.SecureNote, secureNote: { type: 0 } };
		}
		return { ...common, type: CipherType.Login, login: { username: username || null, password: password || null, totp: first(record, ["logintotp"]) || null, uri: uri || null, uris: uri ? [{ uri, match: null }] : [] } };
	});
	return { folders, items, warnings };
}

export function parseVaultImport(text: string, format: "json" | "csv" | "auto" = "auto"): TransferDocument {
	const trimmed = text.trim();
	const selected = format === "auto" ? (trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "csv") : format;
	if (selected === "csv") return parseCsv(text);
	const raw = JSON.parse(trimmed);
	const source = Array.isArray(raw) ? { items: raw } : raw;
	if (source.encrypted === true) throw new Error("暂不支持 Bitwarden 加密 JSON，请导出未加密 JSON");
	const folders = Array.isArray(source.folders) ? source.folders.map((folder: any) => ({ id: folder.id != null ? String(folder.id) : undefined, name: String(folder.name ?? "Folder") })) : [];
	const items = Array.isArray(source.items) ? source.items : Array.isArray(source.ciphers) ? source.ciphers : [];
	if (!folders.length && !items.length) throw new Error("导入文件中没有保险库数据");
	return { folders, items: items.map((item: any, index: number) => ({ ...item, type: Number(item.type || CipherType.Login), name: String(item.name ?? `Imported item ${index + 1}`), key: undefined })), warnings: [] };
}

export function buildBitwardenJson(document: TransferDocument): string {
	return JSON.stringify({ encrypted: false, folders: document.folders, items: document.items }, null, 2);
}

export async function encryptTransferDocument(
	document: TransferDocument,
	encKey: Uint8Array,
	macKey: Uint8Array,
): Promise<EncryptedImportPayload> {
	const folderIndexMap = new Map<string, number>();
	const folders: Array<{ name: string }> = [];
	for (const [index, folder] of document.folders.entries()) {
		if (folder.id != null) folderIndexMap.set(String(folder.id), index);
		folders.push({ name: await encryptStr(folder.name || "Folder", encKey, macKey) });
	}

	const ciphers: NonNullable<CipherImportInput["ciphers"]> = [];
	const folderRelationships: Array<{ key: number; value: number }> = [];
	for (const [index, item] of document.items.entries()) {
		const { id: _id, folderId, key: _key, deletedDate: _deletedDate, ...payload } = item;
		const normalized = {
			...payload,
			type: Number(payload.type) || CipherType.Login,
			name: String(payload.name || "Imported item"),
			notes: payload.notes == null ? null : String(payload.notes),
			favorite: Boolean(payload.favorite),
			reprompt: Number(payload.reprompt) === 1 ? 1 : 0,
			folderId: null,
		};
		ciphers.push(await encryptCipher(normalized, encKey, macKey));
		if (folderId != null) {
			const folderIndex = folderIndexMap.get(String(folderId));
			if (folderIndex !== undefined) folderRelationships.push({ key: index, value: folderIndex });
		}
	}
	return { folders, ciphers, folderRelationships };
}

function csvCell(value: unknown): string {
	const text = String(value ?? "");
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildBitwardenCsv(document: TransferDocument): string {
	const folderById = new Map(document.folders.map((folder) => [folder.id, folder.name]));
	const rows = [["folder", "favorite", "type", "name", "notes", "fields", "reprompt", "login_uri", "login_username", "login_password", "login_totp"]];
	for (const item of document.items) {
		const login = item.login ?? {};
		const csvType = item.type === CipherType.Login ? "login" : "note";
		const typeKey = TYPE_KEYS[item.type];
		const extraTypeData = csvType === "note" && item.type !== CipherType.SecureNote && typeKey
			? `\n\n[Edgewarden ${typeKey}]\n${JSON.stringify(item[typeKey] ?? {})}`
			: "";
		rows.push([folderById.get(item.folderId) ?? "", item.favorite ? "1" : "0", csvType, item.name ?? "", `${item.notes ?? ""}${extraTypeData}`, item.fields ? JSON.stringify(item.fields) : "", String(item.reprompt ?? 0), login.uris?.[0]?.uri ?? login.uri ?? "", login.username ?? "", login.password ?? "", login.totp ?? ""]);
	}
	return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
