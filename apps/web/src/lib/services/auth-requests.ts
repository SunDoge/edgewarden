import { rpc, rpcJson } from "./rpc";
import {
	bytesToBase64,
	base64ToBytes,
	hkdfExpand,
	toBufferSource,
} from "./crypto";

export interface AuthRequest {
	id: string;
	requestDeviceIdentifier: string;
	requestDeviceType: number;
	requestIpAddress: string | null;
	requestCountryName: string | null;
	publicKey: string;
	creationDate: string;
	isExpired: boolean;
	approved: boolean | null;
	fingerprint: string;
}

function normalize(raw: any): Omit<AuthRequest, "fingerprint"> {
	return {
		id: String(raw.id ?? ""),
		requestDeviceIdentifier: String(raw.requestDeviceIdentifier ?? ""),
		requestDeviceType: Number(raw.requestDeviceType ?? 0),
		requestIpAddress: raw.requestIpAddress ?? null,
		requestCountryName: raw.requestCountryName ?? null,
		publicKey: String(raw.publicKey ?? ""),
		creationDate: String(raw.creationDate ?? ""),
		isExpired: Boolean(raw.isExpired),
		approved: raw.approved ?? null,
	};
}

export async function publicKeyFingerprint(
	email: string,
	publicKey: string,
): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest(
			"SHA-256",
			toBufferSource(base64ToBytes(publicKey)),
		),
	);
	const fingerprint = await hkdfExpand(digest, email.trim().toLowerCase(), 20);
	return Array.from(fingerprint, (byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.match(/.{1,8}/g)!
		.join("-");
}

export async function listPendingAuthRequestsApi(
	email: string,
): Promise<AuthRequest[]> {
	const result = await rpcJson<any>(await rpc.api["auth-requests"].$get());
	return Promise.all(
		(result.data ?? []).map(async (row: any) => {
			const request = normalize(row);
			let fingerprint = "";
			try {
				fingerprint = await publicKeyFingerprint(email, request.publicKey);
			} catch {
				/* malformed requests remain rejectable */
			}
			return { ...request, fingerprint };
		}),
	);
}

export async function encryptVaultKeyForAuthRequest(
	requestPublicKey: string,
	symEncKey: Uint8Array,
	symMacKey: Uint8Array,
): Promise<string> {
	if (symEncKey.length !== 32 || symMacKey.length !== 32)
		throw new Error("保险库密钥无效");
	const userKey = new Uint8Array(64);
	userKey.set(symEncKey, 0);
	userKey.set(symMacKey, 32);
	const publicKey = await crypto.subtle.importKey(
		"spki",
		toBufferSource(base64ToBytes(requestPublicKey)),
		{ name: "RSA-OAEP", hash: "SHA-1" },
		false,
		["encrypt"],
	);
	const encrypted = await crypto.subtle.encrypt(
		{ name: "RSA-OAEP" },
		publicKey,
		toBufferSource(userKey),
	);
	return `4.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function respondToAuthRequestApi(
	id: string,
	approved: boolean,
	key?: string,
): Promise<void> {
	await rpcJson(
		await rpc.api["auth-requests"][":id"].$put({
			param: { id },
			json: { approved, key: approved ? key : null, masterPasswordHash: null },
		}),
	);
}
