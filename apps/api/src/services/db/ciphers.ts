import type { Insertable, Kysely, Selectable } from "kysely";
import { LIMITS } from "../../config";
import type { Ciphers, DB } from "../../types/db";
import { now } from "../../utils/time";

export async function getCiphersByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<Ciphers>[]> {
	return db
		.selectFrom("ciphers")
		.selectAll()
		.where("user_id", "=", userId)
		.where("deleted_at", "is", null)
		.execute();
}

export async function getAllCiphersByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<Ciphers>[]> {
	return db
		.selectFrom("ciphers")
		.selectAll()
		.where("user_id", "=", userId)
		.where((expression) =>
			expression.or([
				expression("purge_after", "is", null),
				expression("purge_after", ">", now()),
			]),
		)
		.execute();
}

export async function getCipherById(
	db: Kysely<DB>,
	id: string,
): Promise<Selectable<Ciphers> | null> {
	return (
		(await db
			.selectFrom("ciphers")
			.selectAll()
			.where("id", "=", id)
			.where((expression) =>
				expression.or([
					expression("purge_after", "is", null),
					expression("purge_after", ">", now()),
				]),
			)
			.executeTakeFirst()) ?? null
	);
}

export async function createCipher(
	db: Kysely<DB>,
	cipher: Insertable<Ciphers>,
): Promise<void> {
	await db.insertInto("ciphers").values(cipher).execute();
}

export async function updateCipher(
	db: Kysely<DB>,
	id: string,
	data: Partial<
		Omit<Insertable<Ciphers>, "id" | "created_at" | "user_id" | "org_id">
	>,
): Promise<void> {
	await db
		.updateTable("ciphers")
		.set({ ...data, updated_at: now() })
		.where("id", "=", id)
		.execute();
}

export async function softDeleteCipher(
	db: Kysely<DB>,
	id: string,
	userId: string,
): Promise<boolean> {
	const ts = now();
	const result = await db
		.updateTable("ciphers")
		.set({
			deleted_at: ts,
			purge_after: ts + LIMITS.cipher.trashRetentionSeconds,
			updated_at: ts,
		})
		.where("id", "=", id)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return Number(result.numUpdatedRows) > 0;
}

export async function restoreCipher(
	db: Kysely<DB>,
	id: string,
	userId: string,
): Promise<boolean> {
	const result = await db
		.updateTable("ciphers")
		.set({ deleted_at: null, purge_after: null, updated_at: now() })
		.where("id", "=", id)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return Number(result.numUpdatedRows) > 0;
}

export async function hardDeleteCipher(
	db: Kysely<DB>,
	id: string,
	userId: string,
): Promise<boolean> {
	const result = await db
		.deleteFrom("ciphers")
		.where("id", "=", id)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return Number(result.numDeletedRows) > 0;
}
