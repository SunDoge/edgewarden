import { isoBase64URL } from "@simplewebauthn/server/helpers";

export function bytesToBase64Url(bytes: Uint8Array): string {
	return isoBase64URL.fromBuffer(bytes as any);
}

export function base64UrlToBytes(input: string): Uint8Array {
	return isoBase64URL.toBuffer(input);
}

export function randomChallenge(size = 32): string {
	return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export function parseClientDataJSON(
	base64Url: string,
): { type?: string; challenge?: string; origin?: string } | null {
	try {
		const text = isoBase64URL.toUTF8String(base64Url);
		const parsed = JSON.parse(text) as {
			type?: string;
			challenge?: string;
			origin?: string;
		};
		if (!parsed || typeof parsed !== "object") return null;
		return parsed;
	} catch {
		return null;
	}
}
