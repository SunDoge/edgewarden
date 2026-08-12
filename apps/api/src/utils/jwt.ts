import { sign, verify } from "hono/jwt";
import * as v from "valibot";
import { LIMITS } from "../config";

export type JwtPurpose =
	| "realtime"
	| "attachment-upload"
	| "send-file-download"
	| "send-file-upload"
	| "send-access"
	| "account-passkey";

export async function deriveJwtPurposeSecret(
	secret: string,
	purpose: JwtPurpose,
): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`edgewarden:jwt-purpose:v1:${purpose}:${secret}`),
	);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

const JwtPayloadSchema = v.object({
	typ: v.literal("access"),
	aud: v.literal("edgewarden-api"),
	sub: v.pipe(v.string(), v.minLength(1)),
	email: v.string(),
	name: v.nullable(v.string()),
	email_verified: v.literal(true),
	amr: v.tuple([v.literal("Application")]),
	sstamp: v.pipe(v.string(), v.minLength(1)),
	did: v.optional(v.string()),
	dstamp: v.optional(v.string()),
	iat: v.number(),
	exp: v.number(),
	iss: v.literal("edgewarden"),
	premium: v.literal(true),
});

const RealtimeTicketClaimsSchema = v.object({
	sub: v.pipe(v.string(), v.minLength(1)),
	sstamp: v.pipe(v.string(), v.minLength(1)),
	typ: v.literal("realtime"),
	exp: v.number(),
});

const AttachmentUploadClaimsSchema = v.object({
	userId: v.pipe(v.string(), v.minLength(1)),
	cipherId: v.pipe(v.string(), v.minLength(1)),
	attachmentId: v.pipe(v.string(), v.minLength(1)),
	fileName: v.pipe(v.string(), v.minLength(1)),
	key: v.pipe(v.string(), v.minLength(1)),
	fileSize: v.pipe(v.number(), v.integer(), v.minValue(1)),
	typ: v.literal("attachment_upload"),
	exp: v.number(),
});

const SendFileDownloadClaimsSchema = v.object({
	sendId: v.pipe(v.string(), v.minLength(1)),
	fileId: v.pipe(v.string(), v.minLength(1)),
	storageKey: v.pipe(v.string(), v.minLength(1)),
	jti: v.pipe(v.string(), v.minLength(1)),
	exp: v.number(),
});

const SendFileUploadClaimsSchema = v.object({
	userId: v.pipe(v.string(), v.minLength(1)),
	sendId: v.pipe(v.string(), v.minLength(1)),
	fileId: v.pipe(v.string(), v.minLength(1)),
	exp: v.number(),
});

const SendAccessTokenClaimsSchema = v.object({
	sub: v.pipe(v.string(), v.minLength(1)),
	typ: v.literal("send_access"),
	iat: v.number(),
	exp: v.number(),
});

export type JWTPayload = v.InferOutput<typeof JwtPayloadSchema>;
export type RealtimeTicketClaims = v.InferOutput<
	typeof RealtimeTicketClaimsSchema
>;
export type AttachmentUploadClaims = v.InferOutput<
	typeof AttachmentUploadClaimsSchema
>;
export type SendFileDownloadClaims = v.InferOutput<
	typeof SendFileDownloadClaimsSchema
>;
export type SendFileUploadClaims = v.InferOutput<
	typeof SendFileUploadClaimsSchema
>;
export type SendAccessTokenClaims = v.InferOutput<
	typeof SendAccessTokenClaimsSchema
>;

async function verifyJwtClaims<
	TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(
	token: string,
	secret: string,
	schema: TSchema,
): Promise<v.InferOutput<TSchema> | null> {
	try {
		const payload = await verify(token, secret, "HS256");
		const result = v.safeParse(schema, payload);
		return result.success ? result.output : null;
	} catch {
		return null;
	}
}

export async function createJWT(
	payload: Omit<
		JWTPayload,
		"typ" | "aud" | "iat" | "exp" | "iss" | "premium" | "email_verified" | "amr"
	>,
	secret: string,
	expiresIn: number = LIMITS.auth.accessTokenTtlSeconds,
): Promise<string> {
	const iat = Math.floor(Date.now() / 1000);
	// Build as plain object — hono/jwt sign expects Record<string, unknown>
	const full: Record<string, unknown> = {
		...payload,
		typ: "access",
		aud: "edgewarden-api",
		email_verified: true,
		amr: ["Application"],
		iat,
		exp: iat + expiresIn,
		iss: "edgewarden",
		premium: true,
	};
	return sign(full, secret);
}

export async function verifyJWT(
	token: string,
	secret: string,
): Promise<JWTPayload | null> {
	return verifyJwtClaims(token, secret, JwtPayloadSchema);
}

export function createRefreshToken(): string {
	const bytes = new Uint8Array(LIMITS.auth.refreshTokenRandomBytes);
	crypto.getRandomValues(bytes);
	const base64 = btoa(String.fromCharCode(...bytes));
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex hash of a refresh token for safe storage */
export async function hashRefreshToken(token: string): Promise<string> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function createRealtimeTicket(
	userId: string,
	securityStamp: string,
	secret: string,
): Promise<string> {
	const claims: RealtimeTicketClaims = {
		sub: userId,
		sstamp: securityStamp,
		typ: "realtime",
		exp: Math.floor(Date.now() / 1000) + 60,
	};
	return sign({ ...claims }, await deriveJwtPurposeSecret(secret, "realtime"));
}

export async function verifyRealtimeTicket(
	token: string,
	secret: string,
): Promise<RealtimeTicketClaims | null> {
	return verifyJwtClaims(
		token,
		await deriveJwtPurposeSecret(secret, "realtime"),
		RealtimeTicketClaimsSchema,
	);
}

export async function createAttachmentUploadToken(
	userId: string,
	cipherId: string,
	attachmentId: string,
	metadata: { fileName: string; key: string; fileSize: number },
	secret: string,
): Promise<string> {
	const payload: AttachmentUploadClaims = {
		userId,
		cipherId,
		attachmentId,
		...metadata,
		typ: "attachment_upload",
		exp:
			Math.floor(Date.now() / 1000) + LIMITS.auth.fileDownloadTokenTtlSeconds,
	};
	return sign(
		{ ...payload },
		await deriveJwtPurposeSecret(secret, "attachment-upload"),
	);
}

export async function verifyAttachmentUploadToken(
	token: string,
	secret: string,
): Promise<AttachmentUploadClaims | null> {
	return verifyJwtClaims(
		token,
		await deriveJwtPurposeSecret(secret, "attachment-upload"),
		AttachmentUploadClaimsSchema,
	);
}

export async function createSendFileDownloadToken(
	sendId: string,
	fileId: string,
	storageKey: string,
	secret: string,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const payload: SendFileDownloadClaims = {
		sendId,
		fileId,
		storageKey,
		jti: createRefreshToken(),
		exp: now + LIMITS.auth.fileDownloadTokenTtlSeconds,
	};
	return sign(
		{ ...payload },
		await deriveJwtPurposeSecret(secret, "send-file-download"),
	);
}

export async function verifySendFileDownloadToken(
	token: string,
	secret: string,
): Promise<SendFileDownloadClaims | null> {
	return verifyJwtClaims(
		token,
		await deriveJwtPurposeSecret(secret, "send-file-download"),
		SendFileDownloadClaimsSchema,
	);
}

export async function createSendFileUploadToken(
	userId: string,
	sendId: string,
	fileId: string,
	secret: string,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const payload: SendFileUploadClaims = {
		userId,
		sendId,
		fileId,
		exp: now + LIMITS.auth.fileDownloadTokenTtlSeconds,
	};
	return sign(
		{ ...payload },
		await deriveJwtPurposeSecret(secret, "send-file-upload"),
	);
}

export async function verifySendFileUploadToken(
	token: string,
	secret: string,
): Promise<SendFileUploadClaims | null> {
	return verifyJwtClaims(
		token,
		await deriveJwtPurposeSecret(secret, "send-file-upload"),
		SendFileUploadClaimsSchema,
	);
}

export async function createSendAccessToken(
	sendId: string,
	secret: string,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const payload: SendAccessTokenClaims = {
		sub: sendId,
		typ: "send_access",
		iat: now,
		exp: now + LIMITS.auth.sendAccessTokenTtlSeconds,
	};
	return sign(
		{ ...payload },
		await deriveJwtPurposeSecret(secret, "send-access"),
	);
}

export async function verifySendAccessToken(
	token: string,
	secret: string,
): Promise<SendAccessTokenClaims | null> {
	return verifyJwtClaims(
		token,
		await deriveJwtPurposeSecret(secret, "send-access"),
		SendAccessTokenClaimsSchema,
	);
}
