import { type Kysely, sql } from "kysely";
import { LIMITS } from "../config";
import type { DB } from "../types/db";
import { now } from "../utils/time";

export async function loginAttemptIdentifierHash(
  email: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function isLoginLocked(
  db: Kysely<DB>,
  email: string,
): Promise<boolean> {
  const attempt = await db
    .selectFrom("login_attempts")
    .select(["locked_until"])
    .where("identifier_hash", "=", await loginAttemptIdentifierHash(email))
    .executeTakeFirst();
  return Boolean(attempt?.locked_until && attempt.locked_until > now());
}

export async function recordLoginFailure(
  db: Kysely<DB>,
  email: string,
): Promise<void> {
  const hash = await loginAttemptIdentifierHash(email);
  const ts = now();
  const windowSeconds = LIMITS.auth.loginFailureWindowSeconds;
  const failureLimit = LIMITS.auth.loginFailureLimit;
  const lockoutSeconds = LIMITS.auth.loginLockoutSeconds;
  const initialLockedUntil = failureLimit <= 1 ? ts + lockoutSeconds : null;
  await sql`
		INSERT INTO login_attempts (
			identifier_hash, failure_count, window_started_at, locked_until, updated_at
		)
		VALUES (${hash}, 1, ${ts}, ${initialLockedUntil}, ${ts})
		ON CONFLICT(identifier_hash) DO UPDATE SET
			failure_count = CASE
				WHEN ${ts} - login_attempts.window_started_at < ${windowSeconds}
				THEN login_attempts.failure_count + 1
				ELSE 1
			END,
			window_started_at = CASE
				WHEN ${ts} - login_attempts.window_started_at < ${windowSeconds}
				THEN login_attempts.window_started_at
				ELSE ${ts}
			END,
			locked_until = CASE
				WHEN (
					CASE
						WHEN ${ts} - login_attempts.window_started_at < ${windowSeconds}
						THEN login_attempts.failure_count + 1
						ELSE 1
					END
				) >= ${failureLimit}
				THEN ${ts + lockoutSeconds}
				ELSE NULL
			END,
			updated_at = ${ts}
	`.execute(db);
}

export async function clearLoginFailures(
  db: Kysely<DB>,
  email: string,
): Promise<void> {
  await db
    .deleteFrom("login_attempts")
    .where("identifier_hash", "=", await loginAttemptIdentifierHash(email))
    .execute();
}
