import type { Kysely, Selectable } from "kysely";
import type { DB, Users } from "../types/db";
import {
	createJWT,
	verifyJWT,
	hashRefreshToken,
	createRefreshToken,
} from "../utils/jwt";
import { now } from "../utils/time";
import { LIMITS } from "../config";
import type { JWTPayload } from "../utils/jwt";
import * as usersDb from "./db/users";
import * as devicesDb from "./db/devices";
import * as refreshTokensDb from "./db/refresh-tokens";

const SERVER_HASH_ITERATIONS = 100_000;
const SERVER_HASH_PREFIX = "$s$";

// In-memory cache to avoid hitting D1 on every authenticated request
const userCache = new Map<
	string,
	{ user: Selectable<Users> | null; expiresAt: number }
>();
const deviceCache = new Map<
	string,
	{ stamp: string | null; expiresAt: number }
>();
const CACHE_TTL_MS = 15_000;

export function invalidateUserCache(userId: string) {
	userCache.delete(userId);
	for (const key of deviceCache.keys()) {
		if (key.startsWith(`${userId}:`)) deviceCache.delete(key);
	}
}

/** A full instance restore replaces users and devices outside the request's
 * Kysely connection. Clear isolate-local authentication state immediately so
 * pre-restore access tokens cannot survive until the normal cache TTL. */
export function invalidateAllAuthCaches(): void {
	userCache.clear();
	deviceCache.clear();
}

async function getCachedUser(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<Users> | null> {
	const cached = userCache.get(userId);
	if (cached && cached.expiresAt > Date.now()) return cached.user;
	const user = await usersDb.getUserById(db, userId);
	userCache.set(userId, { user, expiresAt: Date.now() + CACHE_TTL_MS });
	return user;
}

async function getCachedDeviceStamp(
	db: Kysely<DB>,
	userId: string,
	deviceId: string,
): Promise<string | null> {
	const key = `${userId}:${deviceId}`;
	const cached = deviceCache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.stamp;
	const device = await devicesDb.getDevice(db, userId, deviceId);
	const stamp = device?.session_stamp ?? null;
	deviceCache.set(key, { stamp, expiresAt: Date.now() + CACHE_TTL_MS });
	return stamp;
}

/** Server-side second layer: PBKDF2-SHA256(clientHash, email, 100k iterations) */
export async function hashPasswordServer(
	clientHash: string,
	email: string,
): Promise<string> {
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(clientHash),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const salt = new TextEncoder().encode(email.toLowerCase().trim());
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt,
			iterations: SERVER_HASH_ITERATIONS,
		},
		keyMaterial,
		256,
	);
	let binary = "";
	for (const b of new Uint8Array(bits)) binary += String.fromCharCode(b);
	return SERVER_HASH_PREFIX + btoa(binary);
}

function constantTimeEquals(a: string, b: string): boolean {
	const ea = new TextEncoder().encode(a);
	const eb = new TextEncoder().encode(b);
	if (ea.length !== eb.length) return false;
	let diff = 0;
	for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
	return diff === 0;
}

export async function verifyPassword(
	inputHash: string,
	storedHash: string,
	email: string,
): Promise<boolean> {
	if (!storedHash.startsWith(SERVER_HASH_PREFIX)) {
		return constantTimeEquals(inputHash, storedHash);
	}
	const serverHash = await hashPasswordServer(inputHash, email);
	return constantTimeEquals(serverHash, storedHash);
}

export async function generateAccessToken(
	user: Selectable<Users>,
	device?: { identifier: string; sessionStamp: string } | null,
	secret?: string,
): Promise<string> {
	// secret passed in so this function works without env coupling
	return createJWT(
		{
			sub: user.id,
			email: user.email,
			name: user.name,
			sstamp: user.security_stamp,
			...(device
				? { did: device.identifier, dstamp: device.sessionStamp }
				: {}),
		},
		secret!,
	);
}

export async function saveRefreshToken(
	db: Kysely<DB>,
	token: string,
	userId: string,
	deviceIdentifier: string | null,
	deviceSessionStamp: string | null,
): Promise<void> {
	const hashed = await hashRefreshToken(token);
	const expiresAt = now() + LIMITS.auth.refreshTokenTtlSeconds;
	await refreshTokensDb.saveRefreshToken(
		db,
		hashed,
		userId,
		expiresAt,
		deviceIdentifier,
		deviceSessionStamp,
	);
}

export interface VerifiedContext {
	payload: JWTPayload;
	user: Selectable<Users>;
}

export async function verifyAccessToken(
	authHeader: string | null,
	db: Kysely<DB>,
	secret: string,
): Promise<VerifiedContext | null> {
	if (!authHeader) return null;
	const parts = authHeader.split(" ");
	if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;

	const payload = await verifyJWT(parts[1], secret);
	if (!payload) return null;

	let user = await getCachedUser(db, payload.sub);
	// Re-fetch if security stamp mismatch (password changed)
	if (
		!user ||
		user.status !== "active" ||
		payload.sstamp !== user.security_stamp
	) {
		user = await usersDb.getUserById(db, payload.sub);
		userCache.set(payload.sub, { user, expiresAt: Date.now() + CACHE_TTL_MS });
	}
	if (!user || user.status !== "active") return null;
	if (payload.sstamp !== user.security_stamp) return null;

	if (payload.did) {
		let stamp = await getCachedDeviceStamp(db, user.id, payload.did);
		if (!payload.dstamp || stamp !== payload.dstamp) {
			const device = await devicesDb.getDevice(db, user.id, payload.did);
			stamp = device?.session_stamp ?? null;
			deviceCache.set(`${user.id}:${payload.did}`, {
				stamp,
				expiresAt: Date.now() + CACHE_TTL_MS,
			});
		}
		if (!payload.dstamp || stamp !== payload.dstamp) return null;
	}

	return { payload, user };
}

export { createRefreshToken };
