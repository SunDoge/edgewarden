import type { CipherResponse } from "@edgewarden/shared";
import {
	decryptBw,
	decryptStr,
	encryptBw,
	looksLikeCipherString,
} from "./crypto";

// ── Cipher Encryption & Decryption ──────────────────────────────────────────

async function decryptObject(
	obj: any,
	encKey: Uint8Array,
	macKey: Uint8Array,
): Promise<any> {
	if (!obj || typeof obj !== "object") return obj;
	const decrypted = Array.isArray(obj) ? [] : ({} as any);
	for (const key of Object.keys(obj)) {
		const val = obj[key];
		if (typeof val === "string" && looksLikeCipherString(val)) {
			decrypted[key] = await decryptStr(val, encKey, macKey);
		} else if (val && typeof val === "object") {
			decrypted[key] = await decryptObject(val, encKey, macKey);
		} else {
			decrypted[key] = val;
		}
	}
	return decrypted;
}

async function encryptObject(
	value: unknown,
	encKey: Uint8Array,
	macKey: Uint8Array,
	keepPlaintext: (path: readonly (string | number)[]) => boolean = () => false,
	path: readonly (string | number)[] = [],
): Promise<unknown> {
	if (typeof value === "string") {
		if (keepPlaintext(path)) return value || null;
		return value
			? encryptBw(new TextEncoder().encode(value), encKey, macKey)
			: null;
	}
	if (Array.isArray(value))
		return Promise.all(
			value.map((item, index) =>
				encryptObject(item, encKey, macKey, keepPlaintext, [...path, index]),
			),
		);
	if (value && typeof value === "object") {
		const encrypted: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value))
			encrypted[key] = await encryptObject(
				child,
				encKey,
				macKey,
				keepPlaintext,
				[...path, key],
			);
		return encrypted;
	}
	return value;
}

function isPlaintextLoginMetadata(path: readonly (string | number)[]): boolean {
	const field = path.at(-1);
	return field === "passwordRevisionDate" || field === "creationDate";
}

function isPlaintextPasswordHistoryMetadata(
	path: readonly (string | number)[],
): boolean {
	return path.at(-1) === "lastUsedDate";
}

export async function decryptCipher(
	cipher: CipherResponse,
	userEncKey: Uint8Array,
	userMacKey: Uint8Array,
): Promise<any> {
	let encKey = userEncKey;
	let macKey = userMacKey;

	if (cipher.key && looksLikeCipherString(cipher.key)) {
		const rawKey = await decryptBw(cipher.key, userEncKey, userMacKey);
		if (rawKey.length < 64) throw new Error("Invalid cipher key");
		encKey = rawKey.slice(0, 32);
		macKey = rawKey.slice(32, 64);
	}

	const decrypted = { ...cipher } as any;

	if (cipher.name && looksLikeCipherString(cipher.name)) {
		decrypted.name = await decryptStr(cipher.name, encKey, macKey);
	}
	if (cipher.notes && looksLikeCipherString(cipher.notes)) {
		decrypted.notes = await decryptStr(cipher.notes, encKey, macKey);
	}

	if (cipher.login) {
		decrypted.login = await decryptObject(cipher.login, encKey, macKey);
	}
	if (cipher.card) {
		decrypted.card = await decryptObject(cipher.card, encKey, macKey);
	}
	if (cipher.identity) {
		decrypted.identity = await decryptObject(cipher.identity, encKey, macKey);
	}
	if (cipher.secureNote) {
		decrypted.secureNote = await decryptObject(
			cipher.secureNote,
			encKey,
			macKey,
		);
	}
	if (cipher.sshKey)
		decrypted.sshKey = await decryptObject(cipher.sshKey, encKey, macKey);
	if (cipher.bankAccount)
		decrypted.bankAccount = await decryptObject(
			cipher.bankAccount,
			encKey,
			macKey,
		);
	if (cipher.driversLicense)
		decrypted.driversLicense = await decryptObject(
			cipher.driversLicense,
			encKey,
			macKey,
		);
	if (cipher.passport)
		decrypted.passport = await decryptObject(cipher.passport, encKey, macKey);
	if (cipher.attachments?.length) {
		decrypted.attachments = [];
		for (const attachment of cipher.attachments) {
			if (!attachment.key) throw new Error("Attachment key missing");
			const rawAttachmentKey = await decryptBw(attachment.key, encKey, macKey);
			if (rawAttachmentKey.length !== 64)
				throw new Error("Invalid attachment key");
			const attachmentEncKey = rawAttachmentKey.slice(0, 32);
			const attachmentMacKey = rawAttachmentKey.slice(32, 64);
			decrypted.attachments.push({
				...attachment,
				fileName: await decryptStr(
					attachment.fileName,
					attachmentEncKey,
					attachmentMacKey,
				),
				_keys: { enc: attachmentEncKey, mac: attachmentMacKey },
			});
		}
	}
	if (cipher.fields) {
		decrypted.fields = await decryptObject(cipher.fields, encKey, macKey);
	}
	if (cipher.passwordHistory) {
		decrypted.passwordHistory = await decryptObject(
			cipher.passwordHistory,
			encKey,
			macKey,
		);
	}

	return decrypted;
}

export async function encryptCipher(
	fields: {
		type: number;
		name: string;
		notes: string | null;
		favorite: boolean;
		folderId: string | null;
		organizationId?: string | null;
		collectionIds?: string[];
		login?: any;
		card?: any;
		identity?: any;
		secureNote?: any;
		sshKey?: any;
		bankAccount?: any;
		driversLicense?: any;
		passport?: any;
		fields?: any[] | null;
		passwordHistory?: any[] | null;
		key?: string | null;
	},
	userEncKey: Uint8Array,
	userMacKey: Uint8Array,
): Promise<any> {
	let encKey = userEncKey;
	let macKey = userMacKey;
	let wrappedKey = fields.key || null;

	if (wrappedKey && looksLikeCipherString(wrappedKey)) {
		const rawKey = await decryptBw(wrappedKey, userEncKey, userMacKey);
		if (rawKey.length < 64) throw new Error("Invalid cipher key");
		encKey = rawKey.slice(0, 32);
		macKey = rawKey.slice(32, 64);
	}

	if (!wrappedKey) {
		const itemRawKey = crypto.getRandomValues(new Uint8Array(64));
		encKey = itemRawKey.slice(0, 32);
		macKey = itemRawKey.slice(32, 64);
		wrappedKey = await encryptBw(itemRawKey, userEncKey, userMacKey);
	}

	const encoder = new TextEncoder();
	const nameCipher = await encryptBw(
		encoder.encode(fields.name.trim()),
		encKey,
		macKey,
	);
	const notesCipher = fields.notes?.trim()
		? await encryptBw(encoder.encode(fields.notes.trim()), encKey, macKey)
		: null;

	const payload: any = {
		type: fields.type,
		name: nameCipher,
		notes: notesCipher,
		favorite: fields.favorite,
		folderId: fields.folderId,
		organizationId: fields.organizationId ?? null,
		collectionIds: fields.collectionIds ?? [],
		key: wrappedKey,
	};

	const typeData =
		fields.type === 1
			? ["login", fields.login]
			: fields.type === 2
				? ["secureNote", fields.secureNote ?? {}]
				: fields.type === 3
					? ["card", fields.card]
					: fields.type === 4
						? ["identity", fields.identity]
						: fields.type === 5
							? ["sshKey", fields.sshKey]
							: fields.type === 6
								? ["bankAccount", fields.bankAccount]
								: fields.type === 7
									? ["driversLicense", fields.driversLicense]
									: fields.type === 8
										? ["passport", fields.passport]
										: null;
	if (typeData?.[1])
		payload[typeData[0] as string] = await encryptObject(
			typeData[1],
			encKey,
			macKey,
			typeData[0] === "login" ? isPlaintextLoginMetadata : undefined,
		);
	if (fields.fields?.length)
		payload.fields = await encryptObject(fields.fields, encKey, macKey);
	if (fields.passwordHistory?.length)
		payload.passwordHistory = await encryptObject(
			fields.passwordHistory,
			encKey,
			macKey,
			isPlaintextPasswordHistoryMetadata,
		);

	return payload;
}
