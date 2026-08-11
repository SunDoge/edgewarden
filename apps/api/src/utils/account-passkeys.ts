import { sign, verify } from "hono/jwt";
import type {
	AuthenticationResponseJSON,
	AuthenticatorTransportFuture,
	RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Selectable } from "kysely";
import type { WebauthnCredentials } from "../types/db";
import { base64UrlToBytes, bytesToBase64Url } from "./passkey";
import { deriveJwtPurposeSecret } from "./jwt";

export type AccountPasskeyChallengeScope =
	| "Authentication"
	| "CreateCredential"
	| "UpdateKeySet";
export type AccountPasskeyPrfStatus = 0 | 1 | 2;

export interface WebAuthnPrfDecryptionOption {
	EncryptedPrivateKey: string;
	EncryptedUserKey: string;
	CredentialId: string;
	Transports: string[];
	Object: "webAuthnPrfDecryptionOption";
}

const ACCOUNT_PASSKEY_TOKEN_TYPE = "edgewarden.account-passkey.challenge.v1";
const ACCOUNT_PASSKEY_TOKEN_TTL_SECONDS = 17 * 60;
const ACCOUNT_PASSKEY_CREATE_TOKEN_TTL_SECONDS = 7 * 60;
const DEFAULT_RP_NAME = "Edgewarden";

export interface AccountPasskeyTokenPayload {
	typ: typeof ACCOUNT_PASSKEY_TOKEN_TYPE;
	scope: AccountPasskeyChallengeScope;
	challenge: string;
	userId: string | null;
	rpId: string;
	purpose: "login" | "twoFactor";
	iat: number;
	exp: number;
}

export function accountPasskeyTokenTtlSeconds(
	scope: AccountPasskeyChallengeScope,
): number {
	return scope === "CreateCredential"
		? ACCOUNT_PASSKEY_CREATE_TOKEN_TTL_SECONDS
		: ACCOUNT_PASSKEY_TOKEN_TTL_SECONDS;
}

export async function createAccountPasskeyToken(
	jwtSecret: string,
	input: {
		scope: AccountPasskeyChallengeScope;
		challenge: string;
		userId?: string | null;
		rpId: string;
		purpose: "login" | "twoFactor";
		ttlSeconds?: number;
	},
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const exp =
		now + (input.ttlSeconds ?? accountPasskeyTokenTtlSeconds(input.scope));
	const payload: AccountPasskeyTokenPayload = {
		typ: ACCOUNT_PASSKEY_TOKEN_TYPE,
		scope: input.scope,
		challenge: input.challenge,
		userId: input.userId ?? null,
		rpId: input.rpId,
		purpose: input.purpose,
		iat: now,
		exp,
	};
	return await sign(
		payload as any,
		await deriveJwtPurposeSecret(jwtSecret, "account-passkey"),
	);
}

export async function verifyAccountPasskeyToken(
	jwtSecret: string,
	token: string,
	scope: AccountPasskeyChallengeScope,
	purpose: "login" | "twoFactor",
): Promise<AccountPasskeyTokenPayload | null> {
	try {
		const payload = (await verify(
			token,
			await deriveJwtPurposeSecret(jwtSecret, "account-passkey"),
			"HS256",
		)) as unknown as AccountPasskeyTokenPayload;
		if (
			!payload ||
			payload.typ !== ACCOUNT_PASSKEY_TOKEN_TYPE ||
			payload.scope !== scope ||
			payload.purpose !== purpose ||
			!payload.challenge ||
			!payload.rpId ||
			!Number.isFinite(payload.exp)
		) {
			return null;
		}
		if (payload.exp < Math.floor(Date.now() / 1000)) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}

export function getAccountPasskeyRpConfig(
	request: Request,
	env: CloudflareBindings,
): { rpId: string; rpName: string; origins: string[] } {
	const url = new URL(request.url);
	const configuredRpId = String((env as any).WEBAUTHN_RP_ID || "").trim();
	const rpId = configuredRpId || url.hostname;
	const rpName =
		String((env as any).WEBAUTHN_RP_NAME || "").trim() || DEFAULT_RP_NAME;
	const configuredOrigins = String((env as any).WEBAUTHN_ALLOWED_ORIGINS || "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	const origins = new Set<string>([url.origin, ...configuredOrigins]);
	const requestOrigin = request.headers.get("Origin");
	if (
		requestOrigin &&
		(requestOrigin.startsWith("chrome-extension://") ||
			requestOrigin.startsWith("moz-extension://") ||
			requestOrigin.startsWith("safari-web-extension://"))
	) {
		origins.add(requestOrigin);
	}
	return { rpId, rpName, origins: Array.from(origins) };
}

export function userIdToWebAuthnUserId(userId: string): Uint8Array {
	return new TextEncoder().encode(userId);
}

export function userHandleToUserId(
	userHandle: string | undefined,
): string | null {
	if (!userHandle) return null;
	try {
		const decoded = new TextDecoder().decode(base64UrlToBytes(userHandle));
		return decoded.trim() || null;
	} catch {
		return null;
	}
}

export function parseTransports(value: string | null): string[] | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : null;
	} catch {
		return null;
	}
}

export function accountPasskeyPrfStatus(
	credential: Pick<
		Selectable<WebauthnCredentials>,
		| "supports_prf"
		| "encrypted_user_key"
		| "encrypted_public_key"
		| "encrypted_private_key"
	>,
): AccountPasskeyPrfStatus {
	if (!credential.supports_prf) return 2;
	if (
		credential.encrypted_user_key &&
		credential.encrypted_public_key &&
		credential.encrypted_private_key
	) {
		return 0;
	}
	return 1;
}

export function buildWebAuthnPrfOption(
	credential: Selectable<WebauthnCredentials>,
): WebAuthnPrfDecryptionOption | null {
	if (accountPasskeyPrfStatus(credential) !== 0) return null;
	return {
		EncryptedPrivateKey: credential.encrypted_private_key!,
		EncryptedUserKey: credential.encrypted_user_key!,
		CredentialId: credential.credential_id,
		Transports: parseTransports(credential.transports) || [],
		Object: "webAuthnPrfDecryptionOption",
	};
}

export function accountPasskeyCredentialToResponse(
	credential: Selectable<WebauthnCredentials>,
): Record<string, unknown> {
	const prfStatus = accountPasskeyPrfStatus(credential);
	return {
		Id: credential.id,
		id: credential.id,
		Name: credential.name,
		name: credential.name,
		PrfStatus: prfStatus,
		prfStatus,
		EncryptedPublicKey: credential.encrypted_public_key,
		encryptedPublicKey: credential.encrypted_public_key,
		EncryptedUserKey: credential.encrypted_user_key,
		encryptedUserKey: credential.encrypted_user_key,
		CreationDate: new Date(credential.created_at * 1000).toISOString(),
		revisionDate: new Date(credential.updated_at * 1000).toISOString(),
		Object: "webauthnCredential",
		object: "webauthnCredential",
	};
}

export function toSimpleWebAuthnCredential(
	credential: Selectable<WebauthnCredentials>,
): any {
	return {
		id: credential.credential_id,
		publicKey: base64UrlToBytes(credential.public_key),
		counter: credential.counter,
		transports: (parseTransports(credential.transports) || undefined) as any,
	};
}

export function normalizeRegistrationResponse(
	raw: unknown,
): RegistrationResponseJSON | null {
	const input =
		raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
	const response =
		input?.response && typeof input.response === "object"
			? (input.response as Record<string, any>)
			: null;
	if (!input || !response) return null;
	const clientDataJSON = response.clientDataJSON || response.clientDataJson;
	if (
		!input.id ||
		!input.rawId ||
		!clientDataJSON ||
		!response.attestationObject
	)
		return null;
	return {
		id: String(input.id),
		rawId: String(input.rawId),
		type: "public-key",
		authenticatorAttachment: input.authenticatorAttachment,
		clientExtensionResults:
			input.clientExtensionResults || input.extensions || {},
		response: {
			attestationObject: String(response.attestationObject),
			clientDataJSON: String(clientDataJSON),
			authenticatorData: response.authenticatorData
				? String(response.authenticatorData)
				: undefined,
			transports: Array.isArray(response.transports)
				? (response.transports.map(String) as AuthenticatorTransportFuture[])
				: undefined,
			publicKey: response.publicKey ? String(response.publicKey) : undefined,
			publicKeyAlgorithm:
				typeof response.publicKeyAlgorithm === "number"
					? response.publicKeyAlgorithm
					: undefined,
		},
	};
}

export function normalizeAuthenticationResponse(
	raw: unknown,
): AuthenticationResponseJSON | null {
	const input =
		raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
	const response =
		input?.response && typeof input.response === "object"
			? (input.response as Record<string, any>)
			: null;
	if (!input || !response) return null;
	const clientDataJSON = response.clientDataJSON || response.clientDataJson;
	if (
		!input.id ||
		!input.rawId ||
		!clientDataJSON ||
		!response.authenticatorData ||
		!response.signature
	)
		return null;
	return {
		id: String(input.id),
		rawId: String(input.rawId),
		type: "public-key",
		authenticatorAttachment: input.authenticatorAttachment,
		clientExtensionResults:
			input.clientExtensionResults || input.extensions || {},
		response: {
			authenticatorData: String(response.authenticatorData),
			clientDataJSON: String(clientDataJSON),
			signature: String(response.signature),
			userHandle: response.userHandle ? String(response.userHandle) : undefined,
		},
	};
}

export function normalizeAccountPasskeyName(value: unknown): string {
	const normalized = String(value || "").trim();
	return (normalized || "Account passkey").slice(0, 128);
}

export function normalizeTransports(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const transports = value
		.map((item) => String(item || "").trim())
		.filter(Boolean);
	return transports.length ? transports.slice(0, 12) : null;
}

export function isSerializedEncString(value: unknown): value is string {
	const text = String(value || "").trim();
	if (!text) return false;
	const parts = text.split(".");
	if (parts.length !== 2) return false;
	const type = Number(parts[0]);
	const bodyParts = parts[1].split("|");
	if (type === 2) return bodyParts.length === 3 && bodyParts.every(Boolean);
	if (type === 3 || type === 4) return bodyParts.length === 1 && !!bodyParts[0];
	if (type === 5 || type === 6)
		return bodyParts.length === 2 && bodyParts.every(Boolean);
	return false;
}
