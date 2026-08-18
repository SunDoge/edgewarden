export { calcTotpNow, extractTotpSecret } from "./totp.ts";

/**
 * Web Cryptography helpers for Bitwarden-compatible encryption and key derivation.
 */

export function bytesToBase64(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
	return out;
}

/** Base64URL (RFC 4648 §5) — no padding, `-` / `_` instead of `+` / `/` */
export function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
	const normalized = String(value || "")
		.replace(/-/g, "+")
		.replace(/_/g, "/");
	const padded =
		normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
	return base64ToBytes(padded);
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

export function toBufferSource(bytes: Uint8Array): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

export async function sha256Base64(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const hash = await crypto.subtle.digest("SHA-256", toBufferSource(bytes));
	return bytesToBase64(new Uint8Array(hash));
}

const hmacSha256KeyCache = new WeakMap<Uint8Array, Promise<CryptoKey>>();
const aesCbcEncryptKeyCache = new WeakMap<Uint8Array, Promise<CryptoKey>>();
const aesCbcDecryptKeyCache = new WeakMap<Uint8Array, Promise<CryptoKey>>();

function getCachedCryptoKey(
	cache: WeakMap<Uint8Array, Promise<CryptoKey>>,
	keyBytes: Uint8Array,
	create: () => Promise<CryptoKey>,
): Promise<CryptoKey> {
	const cached = cache.get(keyBytes);
	if (cached) return cached;
	const pending = create().catch((error) => {
		cache.delete(keyBytes);
		throw error;
	});
	cache.set(keyBytes, pending);
	return pending;
}

function getHmacSha256Key(keyBytes: Uint8Array): Promise<CryptoKey> {
	return getCachedCryptoKey(hmacSha256KeyCache, keyBytes, () =>
		crypto.subtle.importKey(
			"raw",
			toBufferSource(keyBytes),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		),
	);
}

function getAesCbcEncryptKey(keyBytes: Uint8Array): Promise<CryptoKey> {
	return getCachedCryptoKey(aesCbcEncryptKeyCache, keyBytes, () =>
		crypto.subtle.importKey(
			"raw",
			toBufferSource(keyBytes),
			{ name: "AES-CBC" },
			false,
			["encrypt"],
		),
	);
}

function getAesCbcDecryptKey(keyBytes: Uint8Array): Promise<CryptoKey> {
	return getCachedCryptoKey(aesCbcDecryptKeyCache, keyBytes, () =>
		crypto.subtle.importKey(
			"raw",
			toBufferSource(keyBytes),
			{ name: "AES-CBC" },
			false,
			["decrypt"],
		),
	);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

export async function pbkdf2(
	passwordOrBytes: string | Uint8Array,
	saltOrBytes: string | Uint8Array,
	iterations: number,
	keyLen: number,
): Promise<Uint8Array> {
	const pwdBytes =
		typeof passwordOrBytes === "string"
			? new TextEncoder().encode(passwordOrBytes)
			: passwordOrBytes;
	const saltBytes =
		typeof saltOrBytes === "string"
			? new TextEncoder().encode(saltOrBytes)
			: saltOrBytes;
	const key = await crypto.subtle.importKey(
		"raw",
		toBufferSource(pwdBytes),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: toBufferSource(saltBytes),
			iterations,
		},
		key,
		keyLen * 8,
	);
	return new Uint8Array(bits);
}

export async function hkdfExpand(
	prk: Uint8Array,
	info: string,
	length: number,
): Promise<Uint8Array> {
	const infoBytes = new TextEncoder().encode(info || "");
	const key = await crypto.subtle.importKey(
		"raw",
		toBufferSource(prk),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const result = new Uint8Array(length);
	let previous = new Uint8Array(0);
	let offset = 0;
	let counter = 1;

	while (offset < length) {
		const input = new Uint8Array(previous.length + infoBytes.length + 1);
		input.set(previous, 0);
		input.set(infoBytes, previous.length);
		input[input.length - 1] = counter & 0xff;
		previous = new Uint8Array(
			await crypto.subtle.sign("HMAC", key, toBufferSource(input)),
		);
		const copyLen = Math.min(previous.length, length - offset);
		result.set(previous.slice(0, copyLen), offset);
		offset += copyLen;
		counter += 1;
	}

	return result;
}

export async function hkdf(
	ikm: Uint8Array,
	salt: string | Uint8Array,
	info: string | Uint8Array,
	outputByteSize: number,
): Promise<Uint8Array> {
	const saltBytes =
		typeof salt === "string" ? new TextEncoder().encode(salt) : salt;
	const infoBytes =
		typeof info === "string" ? new TextEncoder().encode(info) : info;
	const params: HkdfParams = {
		name: "HKDF",
		salt: toBufferSource(saltBytes),
		info: toBufferSource(infoBytes),
		hash: "SHA-256",
	};
	const key = await crypto.subtle.importKey(
		"raw",
		toBufferSource(ikm),
		"HKDF",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(params, key, outputByteSize * 8);
	return new Uint8Array(bits);
}

async function hmacSha256(
	keyBytes: Uint8Array,
	dataBytes: Uint8Array,
): Promise<Uint8Array> {
	const key = await getHmacSha256Key(keyBytes);
	return new Uint8Array(
		await crypto.subtle.sign("HMAC", key, toBufferSource(dataBytes)),
	);
}

async function encryptAesCbc(
	data: Uint8Array,
	key: Uint8Array,
	iv: Uint8Array,
): Promise<Uint8Array> {
	const cryptoKey = await getAesCbcEncryptKey(key);
	return new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-CBC", iv: toBufferSource(iv) },
			cryptoKey,
			toBufferSource(data),
		),
	);
}

async function decryptAesCbc(
	data: Uint8Array,
	key: Uint8Array,
	iv: Uint8Array,
): Promise<Uint8Array> {
	const cryptoKey = await getAesCbcDecryptKey(key);
	return new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: "AES-CBC", iv: toBufferSource(iv) },
			cryptoKey,
			toBufferSource(data),
		),
	);
}

export async function encryptBw(
	data: Uint8Array,
	encKey: Uint8Array,
	macKey: Uint8Array,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(16));
	const cipher = await encryptAesCbc(data, encKey, iv);
	const mac = await hmacSha256(macKey, concatBytes(iv, cipher));
	return `2.${bytesToBase64(iv)}|${bytesToBase64(cipher)}|${bytesToBase64(mac)}`;
}

function parseCipherString(s: string): {
	type: number;
	iv: Uint8Array;
	ct: Uint8Array;
	mac: Uint8Array | null;
} {
	if (!s || typeof s !== "string") throw new Error("invalid encrypted string");
	const p = s.indexOf(".");
	if (p <= 0) throw new Error("invalid encrypted string");
	const type = Number(s.slice(0, p));
	const body = s.slice(p + 1);
	const parts = body.split("|");
	if (type === 2 && parts.length === 3) {
		return {
			type: 2,
			iv: base64ToBytes(parts[0]),
			ct: base64ToBytes(parts[1]),
			mac: base64ToBytes(parts[2]),
		};
	}
	if ((type === 0 || type === 1 || type === 4) && parts.length >= 2) {
		return {
			type,
			iv: base64ToBytes(parts[0]),
			ct: base64ToBytes(parts[1]),
			mac: null,
		};
	}
	throw new Error("unsupported enc type");
}

export async function decryptBw(
	cipherString: string,
	encKey: Uint8Array,
	macKey: Uint8Array,
): Promise<Uint8Array> {
	const parsed = parseCipherString(cipherString);
	if (parsed.type === 2 && parsed.mac) {
		const expected = await hmacSha256(
			macKey,
			concatBytes(parsed.iv, parsed.ct),
		);
		if (!constantTimeEqual(expected, parsed.mac))
			throw new Error("MAC mismatch");
	}
	return decryptAesCbc(parsed.ct, encKey, parsed.iv);
}

export async function decryptStr(
	cipherString: string | null | undefined,
	encKey: Uint8Array,
	macKey: Uint8Array,
): Promise<string> {
	if (!cipherString || typeof cipherString !== "string") return "";
	try {
		const plain = await decryptBw(cipherString, encKey, macKey);
		return new TextDecoder().decode(plain);
	} catch (error) {
		// Plain legacy values remain readable, but a serialized encrypted value must
		// never be accepted after authentication or parsing fails.
		if (!looksLikeCipherString(cipherString)) return cipherString;
		throw error;
	}
}

export async function encryptStr(
	plainString: string | null | undefined,
	encKey: Uint8Array,
	macKey: Uint8Array,
): Promise<string> {
	if (!plainString || typeof plainString !== "string") return "";
	const plainBytes = new TextEncoder().encode(plainString);
	return encryptBw(plainBytes, encKey, macKey);
}

// ── Compatibility Helpers ───────────────────────────────────────────────────

export async function deriveMasterKey(
	password: string,
	email: string,
	iterations = 100000,
): Promise<ArrayBuffer> {
	const result = await pbkdf2(password, email, iterations, 32);
	return toBufferSource(result);
}

export async function deriveMasterPasswordHash(
	masterKey: ArrayBuffer,
	password: string,
): Promise<string> {
	const result = await pbkdf2(new Uint8Array(masterKey), password, 1, 32);
	return bytesToBase64(result);
}

export async function rewrapUserKeyForMasterPassword(args: {
	email: string;
	currentPassword: string;
	newPassword: string;
	iterations: number;
	profileKey: string;
}): Promise<{
	currentMasterPasswordHash: string;
	newMasterPasswordHash: string;
	protectedUserKey: string;
	nextMasterKey: ArrayBuffer;
}> {
	const currentMasterKey = await deriveMasterKey(
		args.currentPassword,
		args.email,
		args.iterations,
	);
	const currentMasterPasswordHash = await deriveMasterPasswordHash(
		currentMasterKey,
		args.currentPassword,
	);
	const oldEncKey = await hkdfExpand(
		new Uint8Array(currentMasterKey),
		"enc",
		32,
	);
	const oldMacKey = await hkdfExpand(
		new Uint8Array(currentMasterKey),
		"mac",
		32,
	);
	const userKey = await decryptBw(args.profileKey, oldEncKey, oldMacKey);
	if (userKey.length !== 64) throw new Error("保险库密钥无效");

	const nextMasterKey = await deriveMasterKey(
		args.newPassword,
		args.email,
		args.iterations,
	);
	const newMasterPasswordHash = await deriveMasterPasswordHash(
		nextMasterKey,
		args.newPassword,
	);
	const nextEncKey = await hkdfExpand(new Uint8Array(nextMasterKey), "enc", 32);
	const nextMacKey = await hkdfExpand(new Uint8Array(nextMasterKey), "mac", 32);
	const protectedUserKey = await encryptBw(userKey, nextEncKey, nextMacKey);
	return {
		currentMasterPasswordHash,
		newMasterPasswordHash,
		protectedUserKey,
		nextMasterKey,
	};
}

export async function generateProtectedKey(
	masterKey: ArrayBuffer,
	_password: string,
): Promise<string> {
	return bytesToBase64(new Uint8Array(masterKey));
}

export function looksLikeCipherString(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const match = value.match(/^([0-6])\.([^|]+)\|/);
	return !!match;
}

export async function encryptBwFileData(
	data: Uint8Array,
	encKey: Uint8Array,
	macKey: Uint8Array,
): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(16));
	const cipher = await encryptAesCbc(data, encKey, iv);
	const mac = await hmacSha256(macKey, concatBytes(iv, cipher));
	const out = new Uint8Array(1 + iv.length + mac.length + cipher.length);
	out[0] = 2; // EncryptionType.AesCbc256_HmacSha256_B64
	out.set(iv, 1);
	out.set(mac, 1 + iv.length);
	out.set(cipher, 1 + iv.length + mac.length);
	return out;
}

export async function decryptBwFileData(
	encrypted: Uint8Array,
	encKey: Uint8Array,
	macKey: Uint8Array,
): Promise<Uint8Array> {
	if (!encrypted || encrypted.length < 1 + 16 + 32 + 1) {
		throw new Error("Invalid encrypted file data");
	}
	const encType = encrypted[0];
	if (encType !== 2) {
		throw new Error("Unsupported file encryption type");
	}
	const iv = encrypted.slice(1, 17);
	const mac = encrypted.slice(17, 49);
	const cipher = encrypted.slice(49);
	const expected = await hmacSha256(macKey, concatBytes(iv, cipher));
	if (!constantTimeEqual(expected, mac)) {
		throw new Error("MAC mismatch");
	}
	return decryptAesCbc(cipher, encKey, iv);
}
