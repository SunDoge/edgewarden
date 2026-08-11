import type { Insertable, Kysely, Selectable } from "kysely";
import type { Attachments, DB } from "../../types/db";

export async function listByCipherIds(db: Kysely<DB>, cipherIds: string[]): Promise<Selectable<Attachments>[]> {
	if (!cipherIds.length) return [];
	return db.selectFrom("attachments").selectAll().where("cipher_id", "in", cipherIds).orderBy("created_at", "asc").execute();
}

export async function getById(db: Kysely<DB>, id: string): Promise<Selectable<Attachments> | null> {
	return (await db.selectFrom("attachments").selectAll().where("id", "=", id).executeTakeFirst()) ?? null;
}

export async function create(db: Kysely<DB>, value: Insertable<Attachments>): Promise<void> {
	await db.insertInto("attachments").values(value).execute();
}

export async function remove(db: Kysely<DB>, id: string, cipherId: string): Promise<boolean> {
	const result = await db.deleteFrom("attachments").where("id", "=", id).where("cipher_id", "=", cipherId).executeTakeFirst();
	return Number(result.numDeletedRows) > 0;
}
