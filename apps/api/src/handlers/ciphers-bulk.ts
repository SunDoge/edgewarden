import { vValidator } from "@hono/valibot-validator";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { BulkIdsSchema, MoveCiphersSchema } from "../schemas/ciphers";
import {
	deleteBlobObject,
	getStoredAttachmentObjectKey,
} from "../services/blob-store";
import * as attachmentsDb from "../services/db/attachments";
import { executeBatch, revisionQuery } from "../services/db/batch";
import * as foldersDb from "../services/db/folders";
import { textColumnInJson } from "../services/db/json-array";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";

async function deleteAttachmentObjects(
	env: CloudflareBindings,
	attachments: Array<{ cipher_id: string; id: string }>,
) {
	await Promise.allSettled(
		attachments.map((attachment) =>
			deleteBlobObject(env, getStoredAttachmentObjectKey(attachment)),
		),
	);
}

export const deleteCiphers = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const { ids } = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("ciphers")
				.set({
					deleted_at: ts,
					purge_after: ts + LIMITS.cipher.trashRetentionSeconds,
					updated_at: ts,
				})
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id, ts),
		]);
		return new Response(null, { status: 200 });
	},
);

export const moveCiphers = factory.createHandlers(
	vValidator("json", MoveCiphersSchema),
	async (c) => {
		const { ids, folderId } = c.req.valid("json");
		const userId = c.get("user").id;
		const db = c.get("db");
		if (folderId && !(await foldersDb.getFolderById(db, folderId, userId)))
			return errorResponse("Folder not found", 404);
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("ciphers")
				.set({ folder_id: folderId, updated_at: ts })
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", userId)
				.compile(),
			revisionQuery(db, userId, ts),
		]);
		return new Response(null, { status: 200 });
	},
);

// POST /api/ciphers/delete-permanent (bulk hard delete)
export const hardDeleteCiphers = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const { ids } = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");
		const ownedIds = (
			await db
				.selectFrom("ciphers")
				.select("id")
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", user.id)
				.execute()
		).map((cipher) => cipher.id);
		const attachments = await attachmentsDb.listByCipherIds(db, ownedIds);
		await executeBatch(c.get("dbDialect"), [
			db
				.deleteFrom("ciphers")
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id),
		]);
		await deleteAttachmentObjects(c.env, attachments);
		return new Response(null, { status: 200 });
	},
);

export const archiveCiphers = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const { ids } = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("ciphers")
				.set({ archived_at: ts, updated_at: ts })
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", user.id)
				.where("deleted_at", "is", null)
				.compile(),
			revisionQuery(db, user.id, ts),
		]);
		return new Response(null, { status: 200 });
	},
);

export const unarchiveCiphers = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const { ids } = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("ciphers")
				.set({ archived_at: null, updated_at: ts })
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id, ts),
		]);
		return new Response(null, { status: 200 });
	},
);

// POST /api/ciphers/restore (bulk restore)
export const restoreCiphers = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const { ids } = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("ciphers")
				.set({ deleted_at: null, purge_after: null, updated_at: ts })
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id, ts),
		]);
		return new Response(null, { status: 200 });
	},
);
