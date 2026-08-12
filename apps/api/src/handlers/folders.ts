import { vValidator } from "@hono/valibot-validator";
import { type Selectable, sql } from "kysely";
import { factory } from "../http/factory";
import { BulkIdsSchema } from "../schemas/ciphers";
import { FolderSchema } from "../schemas/folders";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import {
	conditionalFolderRevisionQuery,
	executeBatch,
	folderRevisionQuery,
} from "../services/db/batch";
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
			folderRevisionQuery(db, userId, [id], ts),
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
		const existing = c.get("folder");
		const id = existing.id;
		const ts = Math.max(now(), existing.updated_at + 1);
		const mutationToken = crypto.randomUUID();
		const [updatedResult] = await c
			.get("dbDialect")
			.batch([
				db
					.updateTable("folders")
					.set({ name, updated_at: ts, mutation_token: mutationToken })
					.where("id", "=", id)
					.where("user_id", "=", userId)
					.where(sql<boolean>`mutation_token IS ${existing.mutation_token}`)
					.compile(),
				conditionalFolderRevisionQuery(db, userId, mutationToken, ts),
			]);
		if (updatedResult.numAffectedRows !== 1n)
			return errorResponse("Folder changed during update", 409);
		const folder = await foldersDb.getFolderById(db, id, userId);
		if (!folder) return errorResponse("Not found", 404);
		return c.json(folderToResponse(folder));
	},
);

export const deleteFolder = factory.createHandlers(async (c) => {
	const userId = c.get("user").id;
	const db = c.get("db");
	const folder = c.get("folder");
	const id = folder.id;
	const ts = now();
	const mutationToken = crypto.randomUUID();
	await c.get("dbDialect").batch([
		db
			.updateTable("folders")
			.set({ mutation_token: mutationToken })
			.where("id", "=", id)
			.where("user_id", "=", userId)
			.where(sql<boolean>`mutation_token IS ${folder.mutation_token}`)
			.compile(),
		conditionalFolderRevisionQuery(db, userId, mutationToken, ts),
		db
			.updateTable("ciphers")
			.set({
				folder_id: null,
				updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
			})
			.where("folder_id", "=", id)
			.where("user_id", "=", userId)
			.where((eb) =>
				eb.exists(
					db
						.selectFrom("folders")
						.select("id")
						.where("id", "=", id)
						.where("mutation_token", "=", mutationToken),
				),
			)
			.compile(),
		auditEventInsertQuery(
			db,
			{
				actorUserId: userId,
				action: "folder.delete",
				category: "vault",
				targetType: "folder",
				targetId: id,
				metadata: auditRequestMetadata(c.req.raw),
			},
			sql<boolean>`EXISTS (
				SELECT 1 FROM folders
				WHERE id = ${id}
				  AND user_id = ${userId}
				  AND mutation_token = ${mutationToken}
			)`,
			ts,
		),
		db
			.deleteFrom("folders")
			.where("id", "=", id)
			.where("user_id", "=", userId)
			.where("mutation_token", "=", mutationToken)
			.compile(),
	]);
	return new Response(null, { status: 200 });
});

export const deleteFolders = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const userId = c.get("user").id;
		const db = c.get("db");
		const ids = [...new Set(c.req.valid("json").ids)];
		const ownedFolders = await db
			.selectFrom("folders")
			.select(["id", "mutation_token"])
			.where("user_id", "=", userId)
			.where(textColumnInJson("id", ids))
			.execute();
		if (!ownedFolders.length) return new Response(null, { status: 204 });
		const ts = now();
		const mutationToken = crypto.randomUUID();
		const expectedState = JSON.stringify(ownedFolders);
		await c.get("dbDialect").batch([
			db
				.updateTable("folders")
				.set({ mutation_token: mutationToken })
				.where("user_id", "=", userId)
				.where(sql<boolean>`EXISTS (
					SELECT 1 FROM json_each(${expectedState}) expected
					WHERE json_extract(expected.value, '$.id') = folders.id
					  AND folders.mutation_token IS json_extract(expected.value, '$.mutation_token')
				)`)
				.compile(),
			conditionalFolderRevisionQuery(db, userId, mutationToken, ts),
			db
				.updateTable("ciphers")
				.set({
					folder_id: null,
					updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
				})
				.where("user_id", "=", userId)
				.where((eb) =>
					eb(
						"folder_id",
						"in",
						db
							.selectFrom("folders")
							.select("id")
							.where("user_id", "=", userId)
							.where("mutation_token", "=", mutationToken),
					),
				)
				.compile(),
			auditEventInsertQuery(
				db,
				{
					actorUserId: userId,
					action: "folder.delete.bulk",
					category: "vault",
					targetType: "folder",
					metadata: auditRequestMetadata(c.req.raw),
				},
				sql<boolean>`EXISTS (
					SELECT 1 FROM folders
					WHERE user_id = ${userId}
					  AND mutation_token = ${mutationToken}
				)`,
				ts,
			),
			db
				.deleteFrom("folders")
				.where("user_id", "=", userId)
				.where("mutation_token", "=", mutationToken)
				.compile(),
		]);
		return new Response(null, { status: 204 });
	},
);
