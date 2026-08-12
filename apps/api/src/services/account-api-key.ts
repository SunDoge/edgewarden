import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import { encryptCredential, hashCredential } from "./credential-protection";

/**
 * Rotates an API key only while the caller's authenticated user snapshot is
 * still current. A conflicting rotation returns null instead of returning a
 * credential that was never persisted.
 */
export async function rotateUserApiKey(
	db: Kysely<DB>,
	userId: string,
	expectedEnvelope: string | null,
	dataEncryptionSecret: string,
): Promise<string | null> {
	const key = crypto.randomUUID().replace(/-/g, "");
	const [hash, encrypted] = await Promise.all([
		hashCredential(key),
		encryptCredential(key, dataEncryptionSecret, "api-key"),
	]);
	let query = db
		.updateTable("users")
		.set({
			api_key_hash: hash,
			api_key_encrypted: encrypted,
			updated_at: now(),
		})
		.where("id", "=", userId);
	query = expectedEnvelope
		? query.where("api_key_encrypted", "=", expectedEnvelope)
		: query.where("api_key_encrypted", "is", null);
	const rotated = await query.executeTakeFirst();
	return rotated.numUpdatedRows === 1n ? key : null;
}
