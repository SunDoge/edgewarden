import { base64ToBytes, bytesToBase64, decryptBw, encryptBw } from "./crypto";

export interface SendKeys {
	raw: Uint8Array;
	enc: Uint8Array;
	mac: Uint8Array;
}

export interface DecryptedSend extends Record<string, any> {
	_sendKeys: SendKeys;
	shareKey: string;
}

function utf8(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

async function decryptText(value: unknown, keys: SendKeys): Promise<string> {
	if (typeof value !== "string") return "";
	return new TextDecoder().decode(await decryptBw(value, keys.enc, keys.mac));
}

export function encodeSendShareKey(raw: Uint8Array): string {
	return bytesToBase64(raw)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function decodeSendShareKey(encoded: string): SendKeys {
	if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Send 密钥格式无效");
	const raw = base64ToBytes(encoded.replace(/-/g, "+").replace(/_/g, "/"));
	if (raw.length !== 64) throw new Error("Send 密钥长度无效");
	return { raw, enc: raw.slice(0, 32), mac: raw.slice(32, 64) };
}

export function createSendKeys(): SendKeys {
	const raw = crypto.getRandomValues(new Uint8Array(64));
	return { raw, enc: raw.slice(0, 32), mac: raw.slice(32, 64) };
}

export async function decryptOwnedSend(
	send: Record<string, any>,
	userEncKey: Uint8Array,
	userMacKey: Uint8Array,
): Promise<DecryptedSend> {
	const raw = await decryptBw(send.key, userEncKey, userMacKey);
	if (raw.length !== 64) throw new Error("Send 包装密钥长度无效");
	const keys = { raw, enc: raw.slice(0, 32), mac: raw.slice(32, 64) };
	const result: DecryptedSend = {
		...send,
		_sendKeys: keys,
		shareKey: encodeSendShareKey(raw),
	};
	result.name = await decryptText(send.name, keys);
	result.notes = send.notes ? await decryptText(send.notes, keys) : "";
	if (send.type === 0 && send.text) {
		const encryptedText =
			typeof send.text === "string" ? send.text : send.text.text;
		result.text = {
			...send.text,
			text: await decryptText(encryptedText, keys),
		};
	}
	if (send.type === 1 && send.file) {
		result.file = {
			...send.file,
			fileName: await decryptText(send.file.fileName, keys),
		};
	}
	return result;
}

export async function encryptSendMetadata(
	input: { name: string; notes?: string; text?: string },
	keys: SendKeys,
): Promise<{
	name: string;
	notes: string | null;
	text?: { text: string; hidden: false };
}> {
	const result: {
		name: string;
		notes: string | null;
		text?: { text: string; hidden: false };
	} = {
		name: await encryptBw(utf8(input.name.trim()), keys.enc, keys.mac),
		notes: input.notes?.trim()
			? await encryptBw(utf8(input.notes.trim()), keys.enc, keys.mac)
			: null,
	};
	if (input.text !== undefined)
		result.text = {
			text: await encryptBw(utf8(input.text), keys.enc, keys.mac),
			hidden: false,
		};
	return result;
}

export async function wrapSendKey(
	keys: SendKeys,
	userEncKey: Uint8Array,
	userMacKey: Uint8Array,
): Promise<string> {
	return encryptBw(keys.raw, userEncKey, userMacKey);
}

export async function decryptPublicSend(
	send: Record<string, any>,
	keys: SendKeys,
): Promise<Record<string, any>> {
	const result = { ...send };
	result.name = send.name ? await decryptText(send.name, keys) : "";
	if (send.type === 0 && send.text) {
		result.text = await decryptText(
			typeof send.text === "string" ? send.text : send.text.text,
			keys,
		);
	} else if (send.type === 1 && send.file) {
		result.file = {
			...send.file,
			fileName: await decryptText(send.file.fileName, keys),
		};
	}
	return result;
}
