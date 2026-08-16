import { safeParseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";

const PUBLIC_ID_LENGTH = 12;
const MIN_OTP_LENGTH = 32;
const MAX_OTP_LENGTH = 48;
const MODHEX = /^[cbdefghijklnrtuv]+$/;
const DEFAULT_URL = "https://api.yubico.com/wsapi/2.0/verify";

export interface YubicoCredentials {
	clientId: string;
	secretKey: string;
}
export interface YubikeyConfig {
	keys: string[];
	nfc: boolean;
}

const EMPTY_YUBIKEY_CONFIG: YubikeyConfig = { keys: [], nfc: false };
const YubikeyConfigStorageSchema = v.object({
	keys: v.array(v.unknown()),
	nfc: v.boolean(),
});

export function parseYubikeyConfig(value: unknown): YubikeyConfig {
	if (typeof value !== "string") return EMPTY_YUBIKEY_CONFIG;
	try {
		const parsed = safeParseJsonWithSchema(value, YubikeyConfigStorageSchema);
		if (!parsed) return EMPTY_YUBIKEY_CONFIG;
		const keys = parsed.keys
			.filter((key): key is string => typeof key === "string")
			.map((key) => key.trim().toLowerCase())
			.filter(Boolean)
			.slice(0, 5);
		return { keys, nfc: parsed.nfc };
	} catch {
		return EMPTY_YUBIKEY_CONFIG;
	}
}

export function serializeYubikeyConfig(config: YubikeyConfig): string {
	return JSON.stringify({ keys: config.keys.slice(0, 5), nfc: config.nfc });
}

export function normalizeYubicoOtp(value: string): string {
	return String(value || "")
		.replace(/\s+/g, "")
		.toLowerCase();
}

export function yubicoPublicId(value: string): string | null {
	const otp = normalizeYubicoOtp(value);
	if (
		otp.length < MIN_OTP_LENGTH ||
		otp.length > MAX_OTP_LENGTH ||
		!MODHEX.test(otp)
	)
		return null;
	return otp.slice(0, PUBLIC_ID_LENGTH);
}

export function userYubicoPublicIds(user: Record<string, unknown>): string[] {
	return parseYubikeyConfig(user.yubikey_config).keys;
}

function base64Bytes(value: string): Uint8Array {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesBase64(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function canonical(params: URLSearchParams): string {
	return [...params.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
}

async function signature(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		base64Bytes(secret),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	return bytesBase64(
		new Uint8Array(
			await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
		),
	);
}

function constantTimeEqual(left: string, right: string): boolean {
	const a = new TextEncoder().encode(left);
	const b = new TextEncoder().encode(right);
	let difference = a.length ^ b.length;
	for (let index = 0; index < Math.max(a.length, b.length); index++)
		difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
	return difference === 0;
}

function parseResponse(text: string): Record<string, string> {
	const output: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const separator = line.indexOf("=");
		if (separator > 0)
			output[line.slice(0, separator)] = line.slice(separator + 1);
	}
	return output;
}

export async function verifyYubicoOtp(
	otpInput: string,
	credentials: YubicoCredentials,
	options: { fetcher?: typeof fetch; validationUrl?: string } = {},
): Promise<boolean> {
	const otp = normalizeYubicoOtp(otpInput);
	if (
		!yubicoPublicId(otp) ||
		!credentials.clientId.trim() ||
		!credentials.secretKey.trim()
	)
		return false;
	const nonce = bytesBase64(crypto.getRandomValues(new Uint8Array(18)))
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 24);
	const params = new URLSearchParams({
		id: credentials.clientId.trim(),
		nonce,
		otp,
	});
	try {
		params.set(
			"h",
			await signature(credentials.secretKey.trim(), canonical(params)),
		);
	} catch {
		return false;
	}
	try {
		const response = await (options.fetcher ?? fetch)(
			`${options.validationUrl ?? DEFAULT_URL}?${params.toString()}`,
			{ signal: AbortSignal.timeout(7_000) },
		);
		if (!response.ok) return false;
		const parsed = parseResponse(await response.text());
		if (
			parsed.status !== "OK" ||
			parsed.otp !== otp ||
			parsed.nonce !== nonce ||
			!parsed.h
		)
			return false;
		const signed = new URLSearchParams();
		for (const [key, value] of Object.entries(parsed))
			if (key !== "h") signed.set(key, value);
		return constantTimeEqual(
			await signature(credentials.secretKey.trim(), canonical(signed)),
			parsed.h,
		);
	} catch {
		return false;
	}
}
