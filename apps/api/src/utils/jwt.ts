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

export type JWTPayload = v.InferOutput<typeof JwtPayloadSchema>;

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
	try {
		// hono/jwt verify throws on bad signature, expiration, or malformed token
		const payload = await verify(token, secret, "HS256");
		const result = v.safeParse(JwtPayloadSchema, payload);
		return result.success ? result.output : null;
	} catch {
		return null;
	}
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

export interface SendFileDownloadClaims {
	sendId: string;
	fileId: string;
	jti: string;
	exp: number;
}

export interface SendFileUploadClaims {
	userId: string;
	sendId: string;
	fileId: string;
	exp: number;
}

export interface SendAccessTokenClaims {
	sub: string;
	typ: "send_access";
	iat: number;
	exp: number;
}

export interface AttachmentUploadClaims {
	userId: string;
	cipherId: string;
	attachmentId: string;
	typ: "attachment_upload";
	exp: number;
}

export interface RealtimeTicketClaims {
	sub: string;
	sstamp: string;
	typ: "realtime";
	exp: number;
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
	return sign(claims as any, await deriveJwtPurposeSecret(secret, "realtime"));
}

export async function verifyRealtimeTicket(
	token: string,
	secret: string,
): Promise<RealtimeTicketClaims | null> {
	try {
		const claims = (await verify(
			token,
			await deriveJwtPurposeSecret(secret, "realtime"),
			"HS256",
		)) as unknown as RealtimeTicketClaims;
		if (
			claims.typ !== "realtime" ||
			typeof claims.sub !== "string" ||
			typeof claims.sstamp !== "string"
		)
			return null;
		return claims;
	} catch {
		return null;
	}
}

export async function createAttachmentUploadToken(
	userId: string,
	cipherId: string,
	attachmentId: string,
	secret: string,
): Promise<string> {
	const payload: AttachmentUploadClaims = {
		userId,
		cipherId,
		attachmentId,
		typ: "attachment_upload",
		exp:
			Math.floor(Date.now() / 1000) + LIMITS.auth.fileDownloadTokenTtlSeconds,
	};
	return sign(
		payload as any,
		await deriveJwtPurposeSecret(secret, "attachment-upload"),
	);
}

export async function verifyAttachmentUploadToken(
	token: string,
	secret: string,
): Promise<AttachmentUploadClaims | null> {
	try {
		const claims = (await verify(
			token,
			await deriveJwtPurposeSecret(secret, "attachment-upload"),
			"HS256",
		)) as unknown as AttachmentUploadClaims;
		if (
			claims.typ !== "attachment_upload" ||
			typeof claims.userId !== "string" ||
			typeof claims.cipherId !== "string" ||
			typeof claims.attachmentId !== "string" ||
			typeof claims.exp !== "number" ||
			claims.exp < Math.floor(Date.now() / 1000)
		)
			return null;
		return claims;
	} catch {
		return null;
	}
}

export async function createSendFileDownloadToken(
	sendId: string,
	fileId: string,
	secret: string,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const payload: SendFileDownloadClaims = {
		sendId,
		fileId,
		jti: createRefreshToken(),
		exp: now + LIMITS.auth.fileDownloadTokenTtlSeconds,
	};
	return sign(
		payload as any,
		await deriveJwtPurposeSecret(secret, "send-file-download"),
	);
}

export async function verifySendFileDownloadToken(
	token: string,
	secret: string,
): Promise<SendFileDownloadClaims | null> {
	try {
		const payload = await verify(
			token,
			await deriveJwtPurposeSecret(secret, "send-file-download"),
			"HS256",
		);
		const claims = payload as unknown as SendFileDownloadClaims;
		if (
			typeof claims.sendId !== "string" ||
			typeof claims.fileId !== "string" ||
			typeof claims.jti !== "string" ||
			typeof claims.exp !== "number"
		) {
			return null;
		}
		if (claims.exp < Math.floor(Date.now() / 1000)) return null;
		return claims;
	} catch {
		return null;
	}
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
		payload as any,
		await deriveJwtPurposeSecret(secret, "send-file-upload"),
	);
}

export async function verifySendFileUploadToken(
	token: string,
	secret: string,
): Promise<SendFileUploadClaims | null> {
	try {
		const payload = await verify(
			token,
			await deriveJwtPurposeSecret(secret, "send-file-upload"),
			"HS256",
		);
		const claims = payload as unknown as SendFileUploadClaims;
		if (
			typeof claims.userId !== "string" ||
			typeof claims.sendId !== "string" ||
			typeof claims.fileId !== "string" ||
			typeof claims.exp !== "number"
		) {
			return null;
		}
		if (claims.exp < Math.floor(Date.now() / 1000)) return null;
		return claims;
	} catch {
		return null;
	}
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
		payload as any,
		await deriveJwtPurposeSecret(secret, "send-access"),
	);
}

export async function verifySendAccessToken(
	token: string,
	secret: string,
): Promise<SendAccessTokenClaims | null> {
	try {
		const payload = await verify(
			token,
			await deriveJwtPurposeSecret(secret, "send-access"),
			"HS256",
		);
		const claims = payload as unknown as SendAccessTokenClaims;
		if (
			typeof claims.sub !== "string" ||
			claims.typ !== "send_access" ||
			typeof claims.exp !== "number"
		) {
			return null;
		}
		if (claims.exp < Math.floor(Date.now() / 1000)) return null;
		return claims;
	} catch {
		return null;
	}
}
