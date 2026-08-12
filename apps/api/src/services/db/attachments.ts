import { sql, type Insertable, type Kysely, type Selectable } from "kysely";
import type { Attachments, DB } from "../../types/db";

export async function listByCipherIds(
	db: Kysely<DB>,
	cipherIds: string[],
): Promise<Selectable<Attachments>[]> {
	if (!cipherIds.length) return [];
	return (
		db
			.selectFrom("attachments")
			.selectAll()
			// Explicit bulk operations may still contain many IDs. Passing the set as
			// JSON keeps those operations to one bound parameter.
			.where(
				sql<boolean>`cipher_id in (select value from json_each(${JSON.stringify(cipherIds)}))`,
			)
			.orderBy("created_at", "asc")
			.execute()
	);
}

/** Load attachments for ciphers visible in a full user sync without binding
 * every cipher ID. The joins mirror the ownership checks used to load ciphers. */
export async function listVisibleForSync(
	db: Kysely<DB>,
	userId: string,
	allAccessOrgIds: string[],
	restrictedCollectionIds: string[],
): Promise<Selectable<Attachments>[]> {
	return db
		.selectFrom("attachments as attachment")
		.innerJoin("ciphers as cipher", "cipher.id", "attachment.cipher_id")
		.leftJoin(
			"cipher_collections as collection_link",
			"collection_link.cipher_id",
			"cipher.id",
		)
		.selectAll("attachment")
		.where(
			sql<boolean>`
				cipher.user_id = ${userId}
				or cipher.org_id in (
					select value from json_each(${JSON.stringify(allAccessOrgIds)})
				)
				or collection_link.collection_id in (
					select value from json_each(${JSON.stringify(restrictedCollectionIds)})
				)
			`,
		)
		.distinct()
		.orderBy("attachment.created_at", "asc")
		.execute();
}

export async function getById(
	db: Kysely<DB>,
	id: string,
): Promise<Selectable<Attachments> | null> {
	return (
		(await db
			.selectFrom("attachments")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst()) ?? null
	);
}

export async function create(
	db: Kysely<DB>,
	value: Insertable<Attachments>,
): Promise<void> {
	await db.insertInto("attachments").values(value).execute();
}

export async function remove(
	db: Kysely<DB>,
	id: string,
	cipherId: string,
): Promise<boolean> {
	const result = await db
		.deleteFrom("attachments")
		.where("id", "=", id)
		.where("cipher_id", "=", cipherId)
		.executeTakeFirst();
	return Number(result.numDeletedRows) > 0;
}
