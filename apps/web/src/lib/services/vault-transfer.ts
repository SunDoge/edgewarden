import {
	type CipherImportInput,
	type CipherResponse,
	CipherType,
	type FolderResponse,
} from "@edgewarden/shared";
import {
	decryptPasswordProtectedExport,
	isPasswordProtectedExport,
} from "./bitwarden-encrypted-export";
import { encryptCipher } from "./cipher-crypto";
import { encryptStr } from "./crypto";
import { parseBitwardenCsv } from "./vault-transfer-csv";
export { buildBitwardenCsv } from "./vault-transfer-csv";

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

export interface TransferEncryptionProgress {
	processed: number;
	total: number;
	kind: "folder" | "item";
}

export interface ImportDeduplicationResult {
	document: TransferDocument;
	duplicateItems: number;
	duplicateFolders: number;
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

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, entry]) => entry !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonicalize(entry)]),
		);
	}
	return value;
}

function itemFingerprint(
	item: Record<string, any>,
	folderNames: Map<string, string>,
): string {
	const type = Number(item.type) || CipherType.Login;
	const typeKey = TYPE_KEYS[type];
	return JSON.stringify(
		canonicalize({
			folder:
				item.folderId == null
					? null
					: (folderNames.get(String(item.folderId)) ?? null),
			type,
			name: String(item.name ?? ""),
			notes: item.notes ?? null,
			favorite: Boolean(item.favorite),
			reprompt: Number(item.reprompt) === 1 ? 1 : 0,
			fields: item.fields ?? null,
			passwordHistory: item.passwordHistory ?? null,
			data: typeKey ? (item[typeKey] ?? null) : null,
		}),
	);
}

/**
 * Compares decrypted vault contents in memory. No plaintext or fingerprint leaves
 * the browser. IDs and timestamps are intentionally ignored, while folder names
 * and all user-visible secret data remain part of the comparison.
 */
export function deduplicateTransferDocument(
	incoming: TransferDocument,
	existing: TransferDocument,
): ImportDeduplicationResult {
	const incomingFolderNames = new Map(
		incoming.folders
			.filter((folder) => folder.id != null)
			.map((folder) => [String(folder.id), folder.name]),
	);
	const existingFolderNames = new Map(
		existing.folders
			.filter((folder) => folder.id != null)
			.map((folder) => [String(folder.id), folder.name]),
	);
	const fingerprints = new Set(
		existing.items.map((item) => itemFingerprint(item, existingFolderNames)),
	);
	const items: Array<Record<string, any>> = [];
	let duplicateItems = 0;

	for (const item of incoming.items) {
		const fingerprint = itemFingerprint(item, incomingFolderNames);
		if (fingerprints.has(fingerprint)) {
			duplicateItems++;
			continue;
		}
		fingerprints.add(fingerprint);
		items.push(item);
	}

	const referencedFolderIds = new Set(
		items
			.map((item) => item.folderId)
			.filter((folderId) => folderId != null)
			.map(String),
	);
	const knownFolderNames = new Set(
		existing.folders.map((folder) => folder.name),
	);
	const folders = incoming.folders.filter((folder) => {
		if (folder.id != null && referencedFolderIds.has(String(folder.id)))
			return true;
		if (knownFolderNames.has(folder.name)) return false;
		knownFolderNames.add(folder.name);
		return true;
	});

	return {
		document: { folders, items, warnings: incoming.warnings },
		duplicateItems,
		duplicateFolders: incoming.folders.length - folders.length,
	};
}

export function buildPlainExportDocument(
	folders: FolderResponse[],
	ciphers: CipherResponse[],
): TransferDocument {
	return {
		folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
		items: ciphers
			.filter((cipher) => !cipher.deletedDate)
			.map((cipher: any) => {
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

export function parseVaultImport(
	text: string,
	format: "json" | "csv" | "auto" = "auto",
): TransferDocument {
	const trimmed = text.trim();
	const selected =
		format === "auto"
			? trimmed.startsWith("{") || trimmed.startsWith("[")
				? "json"
				: "csv"
			: format;
	if (selected === "csv") return parseBitwardenCsv(text);
	const raw = JSON.parse(trimmed);
	const source = Array.isArray(raw) ? { items: raw } : raw;
	if (source.encrypted === true) {
		if (isPasswordProtectedExport(source))
			throw new Error("请输入加密导出密码后再导入");
		throw new Error(
			"账户限制型加密 JSON 只能导回原 Bitwarden 账户；请使用密码保护型加密导出",
		);
	}
	const folders = Array.isArray(source.folders)
		? source.folders.map((folder: any) => ({
				id: folder.id != null ? String(folder.id) : undefined,
				name: String(folder.name ?? "Folder"),
			}))
		: [];
	const items = Array.isArray(source.items)
		? source.items
		: Array.isArray(source.ciphers)
			? source.ciphers
			: [];
	if (!folders.length && !items.length)
		throw new Error("导入文件中没有保险库数据");
	return {
		folders,
		items: items.map((item: any, index: number) => ({
			...item,
			type: Number(item.type || CipherType.Login),
			name: String(item.name ?? `Imported item ${index + 1}`),
			key: undefined,
		})),
		warnings: [],
	};
}

export function inspectEncryptedVaultImport(
	text: string,
): "password-protected" | "account-restricted" | null {
	const source: unknown = JSON.parse(text.trim());
	if (
		!source ||
		typeof source !== "object" ||
		!("encrypted" in source) ||
		source.encrypted !== true
	)
		return null;
	return isPasswordProtectedExport(source)
		? "password-protected"
		: "account-restricted";
}

export async function parseVaultImportFile(
	text: string,
	format: "json" | "csv",
	password?: string,
): Promise<TransferDocument> {
	if (format === "csv") return parseVaultImport(text, format);
	const source: unknown = JSON.parse(text.trim());
	if (
		!source ||
		typeof source !== "object" ||
		!("encrypted" in source) ||
		source.encrypted !== true
	) {
		return parseVaultImport(text, format);
	}
	if (!isPasswordProtectedExport(source)) {
		throw new Error(
			"账户限制型加密 JSON 不能跨服务器导入；请从 Bitwarden 导出密码保护型加密 JSON",
		);
	}
	return parseVaultImport(
		await decryptPasswordProtectedExport(source, password ?? ""),
		"json",
	);
}

export function buildBitwardenJson(document: TransferDocument): string {
	return JSON.stringify(
		{ encrypted: false, folders: document.folders, items: document.items },
		null,
		2,
	);
}

export async function encryptTransferDocument(
	document: TransferDocument,
	encKey: Uint8Array,
	macKey: Uint8Array,
	onProgress?: (progress: TransferEncryptionProgress) => void,
): Promise<EncryptedImportPayload> {
	const total = document.folders.length + document.items.length;
	let processed = 0;
	const folderIndexMap = new Map<string, number>();
	const folders: Array<{ name: string }> = [];
	for (const [index, folder] of document.folders.entries()) {
		if (folder.id != null) folderIndexMap.set(String(folder.id), index);
		folders.push({
			name: await encryptStr(folder.name || "Folder", encKey, macKey),
		});
		onProgress?.({ processed: ++processed, total, kind: "folder" });
	}

	const ciphers: NonNullable<CipherImportInput["ciphers"]> = [];
	const folderRelationships: Array<{ key: number; value: number }> = [];
	for (const [index, item] of document.items.entries()) {
		const {
			id: _id,
			folderId,
			key: _key,
			deletedDate: _deletedDate,
			...payload
		} = item;
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
		onProgress?.({ processed: ++processed, total, kind: "item" });
		if (folderId != null) {
			const folderIndex = folderIndexMap.get(String(folderId));
			if (folderIndex !== undefined)
				folderRelationships.push({ key: index, value: folderIndex });
		}
	}
	return { folders, ciphers, folderRelationships };
}
