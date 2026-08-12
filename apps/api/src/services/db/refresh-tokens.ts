import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import { hashRefreshToken } from "../../utils/jwt";
import { now } from "../../utils/time";

export async function saveRefreshToken(
	db: Kysely<DB>,
	hashedToken: string,
	userId: string,
	expiresAt: number,
	deviceIdentifier: string | null,
	deviceSessionStamp: string | null,
): Promise<void> {
	await db
		.insertInto("refresh_tokens")
		.values({
			token: hashedToken,
			user_id: userId,
			expires_at: expiresAt,
			device_identifier: deviceIdentifier,
			device_session_stamp: deviceSessionStamp,
		})
		.onConflict((oc) =>
			oc.column("token").doUpdateSet({
				user_id: userId,
				expires_at: expiresAt,
				device_identifier: deviceIdentifier,
				device_session_stamp: deviceSessionStamp,
			}),
		)
		.execute();
}

export async function getRefreshTokenRecord(
	db: Kysely<DB>,
	rawToken: string,
): Promise<{
	userId: string;
	expiresAt: number;
	deviceIdentifier: string | null;
	deviceSessionStamp: string | null;
} | null> {
	const hashed = await hashRefreshToken(rawToken);
	const row = await db
		.selectFrom("refresh_tokens")
		.selectAll()
		.where("token", "=", hashed)
		.executeTakeFirst();

	if (!row) return null;
	if (row.expires_at <= now()) {
		await deleteRefreshToken(db, rawToken);
		return null;
	}
	return {
		userId: row.user_id,
		expiresAt: row.expires_at,
		deviceIdentifier: row.device_identifier,
		deviceSessionStamp: row.device_session_stamp,
	};
}

export async function deleteRefreshToken(
	db: Kysely<DB>,
	rawToken: string,
): Promise<void> {
	const hashed = await hashRefreshToken(rawToken);
	await db.deleteFrom("refresh_tokens").where("token", "=", hashed).execute();
}

export async function deleteRefreshTokensByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<void> {
	await db.deleteFrom("refresh_tokens").where("user_id", "=", userId).execute();
}

export async function deleteRefreshTokensByDevice(
	db: Kysely<DB>,
	userId: string,
	deviceIdentifier: string,
): Promise<void> {
	await db
		.deleteFrom("refresh_tokens")
		.where("user_id", "=", userId)
		.where("device_identifier", "=", deviceIdentifier)
		.execute();
}

export async function cleanupExpiredRefreshTokens(
	db: Kysely<DB>,
): Promise<void> {
	await db
		.deleteFrom("refresh_tokens")
		.where("expires_at", "<=", now())
		.execute();
}
