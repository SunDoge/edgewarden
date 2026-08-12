import { type Kysely, type Selectable, type Insertable, sql } from "kysely";
import type { DB, Sends } from "../../types/db";
import { now } from "../../utils/time";

export async function getSendsByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<Sends>[]> {
	return db
		.selectFrom("sends")
		.selectAll()
		.where("user_id", "=", userId)
		.where("deletion_date", ">", now())
		.execute();
}

export async function getSendById(
	db: Kysely<DB>,
	id: string,
): Promise<Selectable<Sends> | null> {
	return (
		(await db
			.selectFrom("sends")
			.selectAll()
			.where("id", "=", id)
			.where("deletion_date", ">", now())
			.executeTakeFirst()) ?? null
	);
}

export async function createSend(
	db: Kysely<DB>,
	send: Insertable<Sends>,
): Promise<void> {
	await db.insertInto("sends").values(send).execute();
}

export async function updateSend(
	db: Kysely<DB>,
	id: string,
	data: Partial<Omit<Insertable<Sends>, "id" | "created_at" | "user_id">>,
): Promise<void> {
	await db
		.updateTable("sends")
		.set({ ...data, updated_at: now() })
		.where("id", "=", id)
		.execute();
}

export async function deleteSend(
	db: Kysely<DB>,
	id: string,
	userId: string,
): Promise<boolean> {
	const result = await db
		.deleteFrom("sends")
		.where("id", "=", id)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return Number(result.numDeletedRows) > 0;
}

export async function consumeAccess(
	db: Kysely<DB>,
	id: string,
	timestamp = now(),
): Promise<boolean> {
	const result = await db
		.updateTable("sends")
		.set((eb) => ({
			access_count: eb("access_count", "+", 1),
			updated_at: sql<number>`MAX(updated_at + 1, ${timestamp})`,
		}))
		.where("id", "=", id)
		.where("disabled", "=", 0)
		.where("deletion_date", ">", timestamp)
		.where((eb) =>
			eb.or([
				eb("expiration_date", "is", null),
				eb("expiration_date", ">", timestamp),
			]),
		)
		.where((eb) =>
			eb.or([
				eb("max_access_count", "is", null),
				eb("access_count", "<", eb.ref("max_access_count")),
			]),
		)
		.where("purge_token", "is", null)
		.executeTakeFirst();
	return result.numUpdatedRows === 1n;
}
