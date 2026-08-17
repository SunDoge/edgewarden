import { vValidator } from "@hono/valibot-validator";
import { type CompiledQuery, sql } from "kysely";
import { LIMITS } from "../../config";
import { factory } from "../../http/factory";
import { CipherSchema } from "../../schemas/ciphers";
import { auditEventInsertQuery, auditRequestMetadata } from "../../services/audit";
import {
	conditionalCipherRevisionQuery,
	getCipherPermissions,
	getVisibleCipherCollectionIds,
	organizationCipherViewStateQuery,
	revisionQueriesForCipher,
	validateOrganizationCollections,
} from "../../services/ciphers/access";
import {
	buildCipherData,
	cipherToResponse,
} from "../../services/ciphers/presentation";
import * as attachmentsDb from "../../services/db/attachments";
import { executeBatch } from "../../services/db/batch";
import * as ciphersDb from "../../services/db/ciphers";
import * as foldersDb from "../../services/db/folders";
import { errorResponse } from "../../utils/response";
import { now } from "../../utils/time";

// Delete, restore, and archive operations use compare-and-swap guards to reject concurrent changes instead of overwriting them.
// DELETE /api/ciphers/:id (soft delete, Bitwarden compat)
export const deleteCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	if (cipher.deleted_at !== null) return new Response(null, { status: 200 });
	const deletionTimestamp = now();
	const revisionTimestamp = Math.max(deletionTimestamp, cipher.updated_at + 1);
	const mutationToken = crypto.randomUUID();
	const [deleted] = await c.get("dbDialect").batch([
		db
			.updateTable("ciphers")
			.set({
				deleted_at: deletionTimestamp,
				purge_after: deletionTimestamp + LIMITS.cipher.trashRetentionSeconds,
				updated_at: revisionTimestamp,
				mutation_token: mutationToken,
			})
			.where("id", "=", cipher.id)
			.where("deleted_at", "is", null)
			.where(sql<boolean>`mutation_token IS ${cipher.mutation_token}`)
			.compile(),
		conditionalCipherRevisionQuery(
			db,
			cipher.id,
			mutationToken,
			revisionTimestamp,
		),
		auditEventInsertQuery(
			db,
			{
				actorUserId: c.get("user").id,
				action: "cipher.delete",
				category: "vault",
				targetType: "cipher",
				targetId: cipher.id,
				metadata: auditRequestMetadata(c.req.raw),
			},
			sql<boolean>`EXISTS (
				SELECT 1 FROM ciphers
				WHERE id = ${cipher.id} AND mutation_token = ${mutationToken}
			)`,
			deletionTimestamp,
		),
	]);
	if (deleted.numAffectedRows !== 1n)
		return errorResponse("Cipher changed during deletion", 409);
	return new Response(null, { status: 200 });
});

// PUT /api/ciphers/:id/delete (soft delete)
export const putDeleteCipher = deleteCipher;

// DELETE /api/ciphers/:id/delete (hard delete)
export const hardDeleteCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	const cipherId = cipher.id;
	const deletionTimestamp = now();
	const revisionTimestamp = Math.max(deletionTimestamp, cipher.updated_at + 1);
	const mutationToken = crypto.randomUUID();
	const [deleted] = await c.get("dbDialect").batch([
		db
			.updateTable("ciphers")
			.set({
				deleted_at: deletionTimestamp,
				purge_after: deletionTimestamp,
				updated_at: revisionTimestamp,
				mutation_token: mutationToken,
			})
			.where("id", "=", cipherId)
			.where(sql<boolean>`mutation_token IS ${cipher.mutation_token}`)
			.compile(),
		conditionalCipherRevisionQuery(
			db,
			cipherId,
			mutationToken,
			revisionTimestamp,
		),
		auditEventInsertQuery(
			db,
			{
				actorUserId: c.get("user").id,
				action: "cipher.delete.permanent",
				category: "vault",
				level: "warning",
				targetType: "cipher",
				targetId: cipherId,
				metadata: auditRequestMetadata(c.req.raw),
			},
			sql<boolean>`EXISTS (
				SELECT 1 FROM ciphers
				WHERE id = ${cipherId} AND mutation_token = ${mutationToken}
			)`,
			deletionTimestamp,
		),
	]);
	if (deleted.numAffectedRows !== 1n)
		return errorResponse("Cipher changed during permanent deletion", 409);
	return new Response(null, { status: 200 });
});

// PUT /api/ciphers/:id/restore
export const restoreCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const existing = c.get("cipher");
	const id = existing.id;
	const ts = Math.max(now(), existing.updated_at + 1);
	const mutationToken = crypto.randomUUID();
	const [restored] = await c.get("dbDialect").batch([
		db
			.updateTable("ciphers")
			.set({
				deleted_at: null,
				purge_after: null,
				updated_at: ts,
				mutation_token: mutationToken,
			})
			.where("id", "=", id)
			.where("deleted_at", "is not", null)
			.where("purge_token", "is", null)
			.where(sql<boolean>`mutation_token IS ${existing.mutation_token}`)
			.compile(),
		conditionalCipherRevisionQuery(db, id, mutationToken, ts),
	]);
	if (restored.numAffectedRows !== 1n)
		return errorResponse("Cipher changed during restore", 409);
	const cipher = await ciphersDb.getCipherById(db, id, c.get("user").id);
	if (!cipher) return errorResponse("Cipher changed after restore", 409);
	return c.json(
		cipherToResponse(
			cipher,
			await attachmentsDb.listByCipherIds(db, [cipher.id]),
			await getVisibleCipherCollectionIds(db, id, c.get("orgMember")),
		),
	);
});

export const archiveCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	if (cipher.deleted_at)
		return errorResponse("Cannot archive a deleted cipher", 400);
	if (cipher.archived_at === null) {
		const ts = Math.max(now(), cipher.updated_at + 1);
		const mutationToken = crypto.randomUUID();
		const [archived] = await c.get("dbDialect").batch([
			db
				.updateTable("ciphers")
				.set({
					archived_at: cipher.org_id ? null : now(),
					updated_at: ts,
					mutation_token: mutationToken,
				})
				.where("id", "=", cipher.id)
				.where("deleted_at", "is", null)
				.$if(!cipher.org_id, (query) => query.where("archived_at", "is", null))
				.where(sql<boolean>`mutation_token IS ${cipher.mutation_token}`)
				.compile(),
			...(cipher.org_id
				? [
						organizationCipherViewStateQuery(db, {
							cipherId: cipher.id,
							userId: c.get("user").id,
							folderId: cipher.folder_id,
							favorite: cipher.favorite,
							archivedAt: ts,
							updatedAt: ts,
							committedMutationToken: mutationToken,
						}),
					]
				: []),
			conditionalCipherRevisionQuery(db, cipher.id, mutationToken, ts),
		]);
		if (archived.numAffectedRows !== 1n)
			return errorResponse("Cipher changed during archive", 409);
	}
	const updated = await ciphersDb.getCipherById(
		db,
		cipher.id,
		c.get("user").id,
	);
	if (!updated) return errorResponse("Cipher changed after archive", 409);
	return c.json(
		cipherToResponse(
			updated,
			await attachmentsDb.listByCipherIds(db, [cipher.id]),
			await getVisibleCipherCollectionIds(
				db,
				cipher.id,
				c.get("orgMember"),
			),
		),
	);
});

export const unarchiveCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	if (cipher.deleted_at)
		return errorResponse("Cannot unarchive a deleted cipher", 400);
	if (cipher.archived_at !== null) {
		const ts = Math.max(now(), cipher.updated_at + 1);
		const mutationToken = crypto.randomUUID();
		const [unarchived] = await c.get("dbDialect").batch([
			db
				.updateTable("ciphers")
				.set({
					archived_at: null,
					updated_at: ts,
					mutation_token: mutationToken,
				})
				.where("id", "=", cipher.id)
				.where("deleted_at", "is", null)
				.$if(!cipher.org_id, (query) =>
					query.where("archived_at", "is not", null),
				)
				.where(sql<boolean>`mutation_token IS ${cipher.mutation_token}`)
				.compile(),
			...(cipher.org_id
				? [
						organizationCipherViewStateQuery(db, {
							cipherId: cipher.id,
							userId: c.get("user").id,
							folderId: cipher.folder_id,
							favorite: cipher.favorite,
							archivedAt: null,
							updatedAt: ts,
							committedMutationToken: mutationToken,
						}),
					]
				: []),
			conditionalCipherRevisionQuery(db, cipher.id, mutationToken, ts),
		]);
		if (unarchived.numAffectedRows !== 1n)
			return errorResponse("Cipher changed during unarchive", 409);
	}
	const updated = await ciphersDb.getCipherById(
		db,
		cipher.id,
		c.get("user").id,
	);
	if (!updated) return errorResponse("Cipher changed after unarchive", 409);
	return c.json(
		cipherToResponse(
			updated,
			await attachmentsDb.listByCipherIds(db, [cipher.id]),
			await getVisibleCipherCollectionIds(
				db,
				cipher.id,
				c.get("orgMember"),
			),
		),
	);
});
