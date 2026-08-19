import type { Kysely, Selectable } from "kysely";
import { LIMITS } from "../config";
import type { DB, Users } from "../types/db";
import type { JWTPayload } from "../utils/jwt";
import {
  createJWT,
  createRefreshToken,
  hashRefreshToken,
  verifyJWT,
} from "../utils/jwt";
import { now } from "../utils/time";
import * as devicesDb from "./db/devices";
import * as refreshTokensDb from "./db/refresh-tokens";
import * as usersDb from "./db/users";

const SERVER_HASH_ITERATIONS = 100_000;
const SERVER_HASH_PREFIX = "$s$";

/** Authentication state is deliberately not isolate-cached. Password changes,
 * account bans, deletion, and device revocation must take effect across every
 * Worker isolate on the next request. Keep these hooks so mutation handlers do
 * not need environment-specific cache knowledge. */
export function invalidateUserCache(_userId: string): void {}

/** A full instance restore replaces users and devices outside the request's
 * Kysely connection. Clear isolate-local authentication state immediately so
 * pre-restore access tokens cannot survive until the normal cache TTL. */
export function invalidateAllAuthCaches(): void {}

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

  const user = await usersDb.getUserById(db, payload.sub);
  if (!user || user.status !== "active") return null;
  if (payload.sstamp !== user.security_stamp) return null;

  if (payload.did) {
    const device = await devicesDb.getDevice(db, user.id, payload.did);
    if (!payload.dstamp || device?.session_stamp !== payload.dstamp)
      return null;
  }

  return { payload, user };
}

export { createRefreshToken };
