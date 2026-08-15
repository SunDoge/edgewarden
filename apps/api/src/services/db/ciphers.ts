import type { Insertable, Kysely, Selectable } from "kysely";
import { LIMITS } from "../../config";
import type { Ciphers, DB } from "../../types/db";
import { now } from "../../utils/time";

export type CipherView = Selectable<Ciphers>;

type CipherViewRow = Selectable<Ciphers> & {
	view_folder_id: string | null;
	view_favorite: number;
	view_archived_at: number | null;
};

function toCipherView(row: CipherViewRow): CipherView {
	const { view_folder_id, view_favorite, view_archived_at, ...cipher } = row;
	return {
		...cipher,
		folder_id: cipher.org_id ? view_folder_id : cipher.folder_id,
		favorite: cipher.org_id ? view_favorite : cipher.favorite,
		archived_at: cipher.org_id ? view_archived_at : cipher.archived_at,
	};
}

function selectCipherView(db: Kysely<DB>, userId: string) {
	return db
		.selectFrom("ciphers")
		.leftJoin("cipher_user_settings as view", (join) =>
			join
				.onRef("view.cipher_id", "=", "ciphers.id")
				.on("view.user_id", "=", userId),
		)
		.selectAll("ciphers")
		.select([
			"view.folder_id as view_folder_id",
			"view.favorite as view_favorite",
			"view.archived_at as view_archived_at",
		]);
}

export async function getCiphersByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<Ciphers>[]> {
	return selectCipherView(db, userId)
		.where("ciphers.user_id", "=", userId)
		.where("ciphers.deleted_at", "is", null)
		.execute()
		.then((rows) => rows.map((row) => toCipherView(row as CipherViewRow)));
}

export async function getAllCiphersByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<Ciphers>[]> {
	return selectCipherView(db, userId)
		.where("ciphers.user_id", "=", userId)
		.where((expression) =>
			expression.or([
				expression("ciphers.purge_after", "is", null),
				expression("ciphers.purge_after", ">", now()),
			]),
		)
		.execute()
		.then((rows) => rows.map((row) => toCipherView(row as CipherViewRow)));
}

export async function getCipherById(
	db: Kysely<DB>,
	id: string,
	userId: string,
): Promise<Selectable<Ciphers> | null> {
	const row = await selectCipherView(db, userId)
		.where("ciphers.id", "=", id)
		.where((expression) =>
			expression.or([
				expression("ciphers.purge_after", "is", null),
				expression("ciphers.purge_after", ">", now()),
			]),
		)
		.executeTakeFirst();
	return row ? toCipherView(row as CipherViewRow) : null;
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
