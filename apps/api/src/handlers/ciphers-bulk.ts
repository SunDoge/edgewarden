import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { BulkIdsSchema, MoveCiphersSchema } from "../schemas/ciphers";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import {
	executeFencedPersonalCipherBulkMutation,
	visibleOrganizationCipherViewBulkUpsertQuery,
} from "../services/ciphers/access";
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
		const candidates = await db
			.selectFrom("ciphers")
			.select(["id", "mutation_token"])
			.where(textColumnInJson("id", ids))
			.where("user_id", "=", user.id)
			.where("deleted_at", "is", null)
			.execute();
		await executeFencedPersonalCipherBulkMutation(
			c.get("dbDialect"),
			db,
			user.id,
			candidates,
			ts,
			(mutationToken, expectedState) =>
				db
					.updateTable("ciphers")
					.set({
						deleted_at: ts,
						purge_after: ts + LIMITS.cipher.trashRetentionSeconds,
						updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
						mutation_token: mutationToken,
					})
					.where("user_id", "=", user.id)
					.where("deleted_at", "is", null)
					.where(expectedState),
			(mutationToken) => [
				auditEventInsertQuery(
					db,
					{
						actorUserId: user.id,
						action: "cipher.delete.bulk",
						category: "vault",
						targetType: "cipher",
						metadata: auditRequestMetadata(c.req.raw),
					},
					sql<boolean>`EXISTS (
						SELECT 1 FROM ciphers
						WHERE user_id = ${user.id}
						  AND mutation_token = ${mutationToken}
					)`,
					ts,
				),
			],
		);
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
		const candidates = await db
			.selectFrom("ciphers")
			.select(["id", "mutation_token"])
			.where(textColumnInJson("id", ids))
			.where("user_id", "=", userId)
			.where("deleted_at", "is", null)
			.where(sql<boolean>`folder_id IS NOT ${folderId}`)
			.execute();
		await executeFencedPersonalCipherBulkMutation(
			c.get("dbDialect"),
			db,
			userId,
			candidates,
			ts,
			(mutationToken, expectedState) =>
				db
					.updateTable("ciphers")
					.set({
						folder_id: folderId,
						updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
						mutation_token: mutationToken,
					})
					.where("user_id", "=", userId)
					.where("deleted_at", "is", null)
					.where(expectedState),
		);
		const [organizationViews] = await c.get("dbDialect").batch([
			visibleOrganizationCipherViewBulkUpsertQuery(db, {
				userId,
				cipherIds: ids,
				folderId,
				updatedAt: ts,
			}),
		]);
		if ((organizationViews.numAffectedRows ?? 0n) > 0n)
			await executeBatch(c.get("dbDialect"), [revisionQuery(db, userId, ts)]);
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
		await executeFencedPersonalCipherBulkMutation(
			c.get("dbDialect"),
			db,
			user.id,
			ownedCiphers,
			ts,
			(mutationToken, expectedState) =>
				db
					.updateTable("ciphers")
					.set({
						deleted_at: ts,
						purge_after: ts,
						updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
						mutation_token: mutationToken,
					})
					.where("user_id", "=", user.id)
					.where(expectedState),
			(mutationToken) => [
				auditEventInsertQuery(
					db,
					{
						actorUserId: user.id,
						action: "cipher.delete.permanent.bulk",
						category: "vault",
						level: "warning",
						targetType: "cipher",
						metadata: auditRequestMetadata(c.req.raw),
					},
					sql<boolean>`EXISTS (
						SELECT 1 FROM ciphers
						WHERE user_id = ${user.id}
						  AND mutation_token = ${mutationToken}
					)`,
					ts,
				),
			],
		);
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
		const candidates = await db
			.selectFrom("ciphers")
			.select(["id", "mutation_token"])
			.where(textColumnInJson("id", ids))
			.where("user_id", "=", user.id)
			.where("deleted_at", "is", null)
			.where("archived_at", "is", null)
			.execute();
		await executeFencedPersonalCipherBulkMutation(
			c.get("dbDialect"),
			db,
			user.id,
			candidates,
			ts,
			(mutationToken, expectedState) =>
				db
					.updateTable("ciphers")
					.set({
						archived_at: ts,
						updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
						mutation_token: mutationToken,
					})
					.where("user_id", "=", user.id)
					.where("deleted_at", "is", null)
					.where("archived_at", "is", null)
					.where(expectedState),
		);
		const [organizationViews] = await c.get("dbDialect").batch([
			visibleOrganizationCipherViewBulkUpsertQuery(db, {
				userId: user.id,
				cipherIds: ids,
				archivedAt: ts,
				updatedAt: ts,
			}),
		]);
		if ((organizationViews.numAffectedRows ?? 0n) > 0n)
			await executeBatch(c.get("dbDialect"), [revisionQuery(db, user.id, ts)]);
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
		const candidates = await db
			.selectFrom("ciphers")
			.select(["id", "mutation_token"])
			.where(textColumnInJson("id", ids))
			.where("user_id", "=", user.id)
			.where("deleted_at", "is", null)
			.where("archived_at", "is not", null)
			.execute();
		await executeFencedPersonalCipherBulkMutation(
			c.get("dbDialect"),
			db,
			user.id,
			candidates,
			ts,
			(mutationToken, expectedState) =>
				db
					.updateTable("ciphers")
					.set({
						archived_at: null,
						updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
						mutation_token: mutationToken,
					})
					.where("user_id", "=", user.id)
					.where("deleted_at", "is", null)
					.where("archived_at", "is not", null)
					.where(expectedState),
		);
		const [organizationViews] = await c.get("dbDialect").batch([
			visibleOrganizationCipherViewBulkUpsertQuery(db, {
				userId: user.id,
				cipherIds: ids,
				archivedAt: null,
				updatedAt: ts,
			}),
		]);
		if ((organizationViews.numAffectedRows ?? 0n) > 0n)
			await executeBatch(c.get("dbDialect"), [revisionQuery(db, user.id, ts)]);
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
		const candidates = await db
			.selectFrom("ciphers")
			.select(["id", "mutation_token"])
			.where(textColumnInJson("id", ids))
			.where("user_id", "=", user.id)
			.where("deleted_at", "is not", null)
			.where("purge_after", ">", ts)
			.where("purge_token", "is", null)
			.execute();
		await executeFencedPersonalCipherBulkMutation(
			c.get("dbDialect"),
			db,
			user.id,
			candidates,
			ts,
			(mutationToken, expectedState) =>
				db
					.updateTable("ciphers")
					.set({
						deleted_at: null,
						purge_after: null,
						updated_at: sql<number>`MAX(updated_at + 1, ${ts})`,
						mutation_token: mutationToken,
					})
					.where("user_id", "=", user.id)
					.where("deleted_at", "is not", null)
					.where("purge_after", ">", ts)
					.where("purge_token", "is", null)
					.where(expectedState),
		);
		return new Response(null, { status: 200 });
	},
);
