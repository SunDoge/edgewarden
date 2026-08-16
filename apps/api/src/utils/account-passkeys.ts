import type {
	AuthenticationResponseJSON,
	AuthenticatorTransportFuture,
	RegistrationResponseJSON,
	WebAuthnCredential,
} from "@simplewebauthn/server";
import { safeParseJsonWithSchema } from "@edgewarden/shared";
import { sign, verify } from "hono/jwt";
import type { Selectable } from "kysely";
import * as v from "valibot";
import type { WebauthnCredentials } from "../types/db";
import type { WorkerBindings } from "../worker-bindings";
import { deriveJwtPurposeSecret } from "./jwt";
import { base64UrlToBytes } from "./passkey";

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
const EXTENSION_ORIGIN_PATTERN =
	/^(chrome-extension|moz-extension|safari-web-extension):\/\//;
const AuthenticatorTransportsSchema = v.array(v.string());

const AccountPasskeyTokenPayloadSchema = v.object({
	typ: v.literal(ACCOUNT_PASSKEY_TOKEN_TYPE),
	scope: v.picklist(["Authentication", "CreateCredential", "UpdateKeySet"]),
	challenge: v.pipe(v.string(), v.minLength(1)),
	userId: v.nullable(v.string()),
	rpId: v.pipe(v.string(), v.minLength(1)),
	purpose: v.picklist(["login", "twoFactor"]),
	iat: v.number(),
	exp: v.number(),
});

export type AccountPasskeyTokenPayload = v.InferOutput<
	typeof AccountPasskeyTokenPayloadSchema
>;

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
		{ ...payload },
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
		const payload = await verify(
			token,
			await deriveJwtPurposeSecret(jwtSecret, "account-passkey"),
			"HS256",
		);
		const parsed = v.safeParse(AccountPasskeyTokenPayloadSchema, payload);
		if (
			!parsed.success ||
			parsed.output.scope !== scope ||
			parsed.output.purpose !== purpose ||
			!Number.isFinite(parsed.output.exp)
		) {
			return null;
		}
		if (parsed.output.exp <= Math.floor(Date.now() / 1000)) {
			return null;
		}
		return parsed.output;
	} catch {
		return null;
	}
}

export function getAccountPasskeyRpConfig(
	request: Request,
	env: WorkerBindings,
): { rpId: string; rpName: string; origins: string[] } {
	const url = new URL(request.url);
	const configuredRpId = String(env.WEBAUTHN_RP_ID || "").trim();
	const rpId = configuredRpId || url.hostname;
	const rpName = String(env.WEBAUTHN_RP_NAME || "").trim() || DEFAULT_RP_NAME;
	const configuredOrigins = String(env.WEBAUTHN_ALLOWED_ORIGINS || "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean)
		.flatMap((origin) => {
			try {
				const parsed = new URL(origin);
				const localHttp =
					parsed.protocol === "http:" &&
					(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
				if (
					parsed.origin !== origin ||
					(parsed.protocol !== "https:" && !localHttp)
				) {
					throw new Error("origin must be canonical HTTPS or local HTTP");
				}
				return [parsed.origin];
			} catch (error) {
				console.warn(
					JSON.stringify({
						event: "webauthn.origin.invalid",
						origin,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
				return [];
			}
		});
	const origins = new Set<string>([url.origin, ...configuredOrigins]);
	const requestOrigin = request.headers.get("Origin");
	if (requestOrigin && EXTENSION_ORIGIN_PATTERN.test(requestOrigin)) {
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
	return safeParseJsonWithSchema(value, AuthenticatorTransportsSchema);
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
	const encryptedPrivateKey = credential.encrypted_private_key;
	const encryptedUserKey = credential.encrypted_user_key;
	if (!encryptedPrivateKey || !encryptedUserKey) return null;
	return {
		EncryptedPrivateKey: encryptedPrivateKey,
		EncryptedUserKey: encryptedUserKey,
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
): WebAuthnCredential {
	const transports = parseTransports(credential.transports)?.filter(
		(value): value is AuthenticatorTransportFuture =>
			AUTHENTICATOR_TRANSPORTS.has(value as AuthenticatorTransportFuture),
	);
	return {
		id: credential.credential_id,
		publicKey: base64UrlToBytes(credential.public_key),
		counter: credential.counter,
		transports: transports?.length ? transports : undefined,
	};
}

const AUTHENTICATOR_TRANSPORTS = new Set<AuthenticatorTransportFuture>([
	"ble",
	"cable",
	"hybrid",
	"internal",
	"nfc",
	"smart-card",
	"usb",
]);

function objectRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function authenticatorAttachment(
	value: unknown,
): "cross-platform" | "platform" | undefined {
	return value === "cross-platform" || value === "platform" ? value : undefined;
}

function clientExtensionResults(
	value: unknown,
): RegistrationResponseJSON["clientExtensionResults"] {
	return objectRecord(value) ?? {};
}

export function normalizeRegistrationResponse(
	raw: unknown,
): RegistrationResponseJSON | null {
	const input = objectRecord(raw);
	const response =
		input?.response && typeof input.response === "object"
			? objectRecord(input.response)
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
		authenticatorAttachment: authenticatorAttachment(
			input.authenticatorAttachment,
		),
		clientExtensionResults: clientExtensionResults(
			input.clientExtensionResults ?? input.extensions,
		),
		response: {
			attestationObject: String(response.attestationObject),
			clientDataJSON: String(clientDataJSON),
			authenticatorData: response.authenticatorData
				? String(response.authenticatorData)
				: undefined,
			transports: Array.isArray(response.transports)
				? response.transports
						.map(String)
						.filter((value): value is AuthenticatorTransportFuture =>
							AUTHENTICATOR_TRANSPORTS.has(
								value as AuthenticatorTransportFuture,
							),
						)
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
	const input = objectRecord(raw);
	const response =
		input?.response && typeof input.response === "object"
			? objectRecord(input.response)
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
		authenticatorAttachment: authenticatorAttachment(
			input.authenticatorAttachment,
		),
		clientExtensionResults: clientExtensionResults(
			input.clientExtensionResults ?? input.extensions,
		),
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
