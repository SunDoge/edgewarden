import type { Kysely } from "kysely";
import { LIMITS } from "../config";
import type { DB } from "../types/db";
import { now } from "../utils/time";

async function identifierHash(email: string): Promise<string> {
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
		.where("identifier_hash", "=", await identifierHash(email))
		.executeTakeFirst();
	return Boolean(attempt?.locked_until && attempt.locked_until > now());
}

export async function recordLoginFailure(
	db: Kysely<DB>,
	email: string,
): Promise<void> {
	const hash = await identifierHash(email);
	const ts = now();
	const existing = await db
		.selectFrom("login_attempts")
		.selectAll()
		.where("identifier_hash", "=", hash)
		.executeTakeFirst();
	const insideWindow =
		existing &&
		ts - existing.window_started_at < LIMITS.auth.loginFailureWindowSeconds;
	const failureCount = insideWindow ? existing.failure_count + 1 : 1;
	const lockedUntil =
		failureCount >= LIMITS.auth.loginFailureLimit
			? ts + LIMITS.auth.loginLockoutSeconds
			: null;
	await db
		.insertInto("login_attempts")
		.values({
			identifier_hash: hash,
			failure_count: failureCount,
			window_started_at: insideWindow ? existing.window_started_at : ts,
			locked_until: lockedUntil,
			updated_at: ts,
		})
		.onConflict((conflict) =>
			conflict.column("identifier_hash").doUpdateSet({
				failure_count: failureCount,
				window_started_at: insideWindow ? existing.window_started_at : ts,
				locked_until: lockedUntil,
				updated_at: ts,
			}),
		)
		.execute();
}

export async function clearLoginFailures(
	db: Kysely<DB>,
	email: string,
): Promise<void> {
	await db
		.deleteFrom("login_attempts")
		.where("identifier_hash", "=", await identifierHash(email))
		.execute();
}
