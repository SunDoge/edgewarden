import { vValidator } from "@hono/valibot-validator";
import type { Selectable } from "kysely";
import { factory } from "../http/factory";
import { FolderSchema } from "../schemas/folders";
import { BulkIdsSchema } from "../schemas/ciphers";
import { executeBatch, revisionQuery } from "../services/db/batch";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import * as foldersDb from "../services/db/folders";
import { textColumnInJson } from "../services/db/json-array";
import type { Folders } from "../types/db";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";

function folderToResponse(folder: Selectable<Folders>) {
	return {
		id: folder.id,
		name: folder.name,
		revisionDate: toIso(folder.updated_at),
		object: "folder",
	};
}

export const listFolders = factory.createHandlers(async (c) => {
	const folders = await foldersDb.getFoldersByUserId(
		c.get("db"),
		c.get("user").id,
	);
	return c.json({
		data: folders.map(folderToResponse),
		object: "list",
		continuationToken: null,
	});
});

export const createFolder = factory.createHandlers(
	vValidator("json", FolderSchema),
	async (c) => {
		const { name } = c.req.valid("json");
		const userId = c.get("user").id;
		const db = c.get("db");
		const id = crypto.randomUUID();
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.insertInto("folders")
				.values({ id, user_id: userId, name, created_at: ts, updated_at: ts })
				.compile(),
			revisionQuery(db, userId, ts),
		]);
		const folder = await foldersDb.getFolderById(db, id, userId);
		if (!folder) return errorResponse("Failed to create folder", 500);
		return c.json(folderToResponse(folder), 200);
	},
);

export const getFolder = factory.createHandlers(async (c) => {
	return c.json(folderToResponse(c.get("folder")));
});

export const updateFolder = factory.createHandlers(
	vValidator("json", FolderSchema),
	async (c) => {
		const { name } = c.req.valid("json");
		const userId = c.get("user").id;
		const db = c.get("db");
		const id = c.get("folder").id;
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("folders")
				.set({ name, updated_at: ts })
				.where("id", "=", id)
				.where("user_id", "=", userId)
				.compile(),
			revisionQuery(db, userId, ts),
		]);
		const folder = await foldersDb.getFolderById(db, id, userId);
		if (!folder) return errorResponse("Not found", 404);
		return c.json(folderToResponse(folder));
	},
);

export const deleteFolder = factory.createHandlers(async (c) => {
	const userId = c.get("user").id;
	const db = c.get("db");
	const id = c.get("folder").id;
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("ciphers")
			.set({ folder_id: null, updated_at: ts })
			.where("folder_id", "=", id)
			.where("user_id", "=", userId)
			.compile(),
		db
			.deleteFrom("folders")
			.where("id", "=", id)
			.where("user_id", "=", userId)
			.compile(),
		revisionQuery(db, userId, ts),
	]);
	return new Response(null, { status: 200 });
});

export const deleteFolders = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const userId = c.get("user").id;
		const db = c.get("db");
		const ids = [...new Set(c.req.valid("json").ids)];
		const ownedIds = (
			await db
				.selectFrom("folders")
				.select("id")
				.where("user_id", "=", userId)
				.where(textColumnInJson("id", ids))
				.execute()
		).map((folder) => folder.id);
		if (!ownedIds.length) return new Response(null, { status: 204 });
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("ciphers")
				.set({ folder_id: null, updated_at: ts })
				.where("user_id", "=", userId)
				.where(textColumnInJson("folder_id", ownedIds))
				.compile(),
			db
				.deleteFrom("folders")
				.where("user_id", "=", userId)
				.where(textColumnInJson("id", ownedIds))
				.compile(),
			revisionQuery(db, userId, ts),
		]);
		await safeWriteAuditEvent(db, {
			actorUserId: userId,
			action: "folder.delete.bulk",
			category: "vault",
			targetType: "folder",
			metadata: { ...auditRequestMetadata(c.req.raw), size: ownedIds.length },
		});
		return new Response(null, { status: 204 });
	},
);
