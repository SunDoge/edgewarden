import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { BulkIdsSchema, MoveCiphersSchema } from "../schemas/ciphers";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { conditionalPersonalCipherBulkRevisionQuery } from "../services/ciphers/access";
import { executeBatch, revisionQuery } from "../services/db/batch";
import * as foldersDb from "../services/db/folders";
import { textColumnInJson } from "../services/db/json-array";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";

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
		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "cipher.delete.bulk",
			category: "vault",
			targetType: "cipher",
			metadata: { ...auditRequestMetadata(c.req.raw), size: ids.length },
		});
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
		const ts = now();
		const ownedCiphers = await db
			.selectFrom("ciphers")
			.select(["id", "mutation_token"])
			.where(textColumnInJson("id", ids))
			.where("user_id", "=", user.id)
			.where((eb) =>
				eb.or([eb("purge_after", "is", null), eb("purge_after", ">", ts)]),
			)
			.execute();
		if (ownedCiphers.length) {
			const mutationToken = crypto.randomUUID();
			const expectedState = JSON.stringify(ownedCiphers);
			const [deleted] = await c.get("dbDialect").batch([
				db
					.updateTable("ciphers")
					.set({
						deleted_at: ts,
						purge_after: ts,
						updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
						mutation_token: mutationToken,
					})
					.where("user_id", "=", user.id)
					.where(sql<boolean>`EXISTS (
						SELECT 1 FROM json_each(${expectedState}) expected
						WHERE json_extract(expected.value, '$.id') = ciphers.id
						  AND ciphers.mutation_token IS json_extract(expected.value, '$.mutation_token')
					)`)
					.compile(),
				conditionalPersonalCipherBulkRevisionQuery(
					db,
					user.id,
					mutationToken,
					ts,
				),
			]);
			const deletedCount = Number(deleted.numAffectedRows);
			if (deletedCount > 0)
				await safeWriteAuditEvent(db, {
					actorUserId: user.id,
					action: "cipher.delete.permanent.bulk",
					category: "vault",
					level: "warning",
					targetType: "cipher",
					metadata: {
						...auditRequestMetadata(c.req.raw),
						size: deletedCount,
					},
				});
		}
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
