import type { Kysely, Selectable, Insertable } from "kysely";
import type { DB, Folders } from "../../types/db";
import { now } from "../../utils/time";

export async function getFoldersByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<Folders>[]> {
	return db
		.selectFrom("folders")
		.selectAll()
		.where("user_id", "=", userId)
		.orderBy("updated_at", "desc")
		.execute();
}

export async function getFolderById(
	db: Kysely<DB>,
	id: string,
	userId: string,
): Promise<Selectable<Folders> | null> {
	return (
		(await db
			.selectFrom("folders")
			.selectAll()
			.where("id", "=", id)
			.where("user_id", "=", userId)
			.executeTakeFirst()) ?? null
	);
}

export async function createFolder(
	db: Kysely<DB>,
	folder: Insertable<Folders>,
): Promise<void> {
	await db.insertInto("folders").values(folder).execute();
}

export async function updateFolder(
	db: Kysely<DB>,
	id: string,
	userId: string,
	name: string,
): Promise<boolean> {
	const result = await db
		.updateTable("folders")
		.set({ name, updated_at: now() })
		.where("id", "=", id)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return Number(result.numUpdatedRows) > 0;
}

export async function deleteFolder(
	db: Kysely<DB>,
	id: string,
	userId: string,
): Promise<boolean> {
	// Move ciphers out of folder before deleting
	await db
		.updateTable("ciphers")
		.set({ folder_id: null, updated_at: now() })
		.where("folder_id", "=", id)
		.where("user_id", "=", userId)
		.execute();

	const result = await db
		.deleteFrom("folders")
		.where("id", "=", id)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return Number(result.numDeletedRows) > 0;
}
