import { vValidator } from "@hono/valibot-validator";
import { type CompiledQuery, sql } from "kysely";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { CipherSchema } from "../schemas/ciphers";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import {
	conditionalCipherRevisionQuery,
	getCipherCollectionIds,
	getCipherPermissions,
	revisionQueriesForCipher,
	validateOrganizationCollections,
} from "../services/ciphers/access";
import {
	buildCipherData,
	cipherToResponse,
} from "../services/ciphers/presentation";
import * as attachmentsDb from "../services/db/attachments";
import { executeBatch } from "../services/db/batch";
import * as ciphersDb from "../services/db/ciphers";
import * as foldersDb from "../services/db/folders";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";

// GET /api/ciphers
export const listCiphers = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const db = c.get("db");
	const ciphers = await ciphersDb.getCiphersByUserId(db, user.id);
	const attachments = await attachmentsDb.listByCipherIds(
		db,
		ciphers.map((cipher) => cipher.id),
	);
	const attachmentsByCipher = Map.groupBy(
		attachments,
		(attachment) => attachment.cipher_id,
	);
	return c.json({
		data: ciphers.map((cipher) =>
			cipherToResponse(cipher, attachmentsByCipher.get(cipher.id)),
		),
		object: "list",
		continuationToken: null,
	});
});

// POST /api/ciphers
// POST /api/ciphers/create
export const createCipher = factory.createHandlers(
	vValidator("json", CipherSchema),
	async (c) => {
		const body = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");
		const id = crypto.randomUUID();
		const ts = now();
		const organizationId = body.organizationId ?? null;
		const collectionIds = body.collectionIds ?? [];
		if (!organizationId && collectionIds.length)
			return errorResponse("Personal ciphers cannot use collections", 400);
		if (organizationId && body.folderId)
			return errorResponse("Organization ciphers cannot use folders", 400);
		if (
			!organizationId &&
			body.folderId &&
			!(await foldersDb.getFolderById(db, body.folderId, user.id))
		) {
			return errorResponse("Folder not found", 400);
		}

		const access = organizationId
			? await validateOrganizationCollections(
					db,
					user.id,
					organizationId,
					collectionIds,
				)
			: null;
		if (access && "error" in access && access.error)
			return errorResponse(
				access.error,
				access.error.includes("not found") ? 404 : 403,
			);
		const values = {
			id,
			user_id: organizationId ? null : user.id,
			org_id: organizationId,
			type: body.type,
			folder_id: organizationId ? null : (body.folderId ?? null),
			name: body.name,
			notes: body.notes ?? null,
			favorite: body.favorite ? 1 : 0,
			reprompt: body.reprompt ?? 0,
			key: body.key ?? null,
			data: buildCipherData(body),
			fields: body.fields ? JSON.stringify(body.fields) : null,
			password_history: body.passwordHistory
				? JSON.stringify(body.passwordHistory)
				: null,
			created_at: ts,
			updated_at: ts,
		};
		const owner = {
			user_id: organizationId ? null : user.id,
			org_id: organizationId,
		};
		await executeBatch(c.get("dbDialect"), [
			db.insertInto("ciphers").values(values).compile(),
			...collectionIds.map((collectionId) =>
				db
					.insertInto("cipher_collections")
					.values({ cipher_id: id, collection_id: collectionId })
					.compile(),
			),
			...(await revisionQueriesForCipher(db, owner, ts)),
		]);

		const created = await ciphersDb.getCipherById(db, id);
		if (!created) {
			console.error(
				JSON.stringify({
					event: "cipher.create_readback_missing",
					cipherId: id,
					userId: user.id,
				}),
			);
			return errorResponse("Cipher could not be read after creation", 500);
		}
		return c.json(cipherToResponse(created, [], collectionIds), 200);
	},
);

// GET /api/ciphers/:id
export const getCipher = factory.createHandlers(async (c) => {
	const cipher = c.get("cipher");
	const db = c.get("db");
	const collectionIds = await getCipherCollectionIds(db, cipher.id);
	const permissions = await getCipherPermissions(
		db,
		cipher,
		c.get("orgMember"),
		collectionIds,
	);
	return c.json(
		cipherToResponse(
			cipher,
			await attachmentsDb.listByCipherIds(db, [cipher.id]),
			collectionIds,
			permissions,
		),
	);
});

// PUT /api/ciphers/:id
export const updateCipher = factory.createHandlers(
	vValidator("json", CipherSchema),
	async (c) => {
		const body = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");
		const cipher = c.get("cipher");
		if ((body.organizationId ?? null) !== (cipher.org_id ?? null))
			return errorResponse("Cipher ownership cannot be changed", 400);
		const collectionIds = body.collectionIds ?? [];
		if (cipher.org_id && body.folderId)
			return errorResponse("Organization ciphers cannot use folders", 400);
		if (!cipher.org_id && collectionIds.length)
			return errorResponse("Personal ciphers cannot use collections", 400);
		if (
			!cipher.org_id &&
			body.folderId &&
			!(await foldersDb.getFolderById(db, body.folderId, user.id))
		) {
			return errorResponse("Folder not found", 400);
		}
		if (cipher.org_id) {
			const access = await validateOrganizationCollections(
				db,
				user.id,
				cipher.org_id,
				collectionIds,
			);
			if ("error" in access && access.error)
				return errorResponse(
					access.error,
					access.error.includes("not found") ? 404 : 403,
				);
		}
		if (body.lastKnownRevisionDate) {
			const expectedRevision = Math.floor(
				Date.parse(body.lastKnownRevisionDate) / 1000,
			);
			if (expectedRevision !== cipher.updated_at) {
				return errorResponse(
					"Cipher has been modified since it was last retrieved",
					409,
				);
			}
		}

		// Keep revisions monotonic even when two writes happen in the same second.
		const ts = Math.max(now(), cipher.updated_at + 1);
		const mutationToken = crypto.randomUUID();
		const updateQuery = db
			.updateTable("ciphers")
			.set({
				type: body.type,
				folder_id: cipher.org_id ? null : (body.folderId ?? null),
				name: body.name,
				notes: body.notes ?? null,
				favorite: body.favorite ? 1 : 0,
				reprompt: body.reprompt ?? 0,
				key: body.key ?? null,
				data: buildCipherData(body),
				fields: body.fields ? JSON.stringify(body.fields) : null,
				password_history: body.passwordHistory
					? JSON.stringify(body.passwordHistory)
					: null,
				updated_at: ts,
				mutation_token: mutationToken,
			})
			.where("id", "=", cipher.id)
			.$if(Boolean(body.lastKnownRevisionDate), (query) =>
				query.where("updated_at", "=", cipher.updated_at),
			)
			.compile();
		const committedCipher = db
			.selectFrom("ciphers")
			.select("id")
			.where("id", "=", cipher.id)
			.where("mutation_token", "=", mutationToken);
		const followupQueries: CompiledQuery[] = [
			db
				.deleteFrom("cipher_collections")
				.where("cipher_id", "=", cipher.id)
				.where(({ exists }) => exists(committedCipher))
				.compile(),
			...collectionIds.map((collectionId) =>
				db
					.insertInto("cipher_collections")
					.columns(["cipher_id", "collection_id"])
					.expression(
						db
							.selectNoFrom([
								sql<string>`${cipher.id}`.as("cipher_id"),
								sql<string>`${collectionId}`.as("collection_id"),
							])
							.where(({ exists }) => exists(committedCipher)),
					)
					.compile(),
			),
			conditionalCipherRevisionQuery(db, cipher.id, mutationToken, ts),
		];
		const [updateResult] = await c
			.get("dbDialect")
			.batch([updateQuery, ...followupQueries]);
		if (updateResult.numAffectedRows === 0n) {
			return errorResponse(
				"Cipher has been modified since it was last retrieved",
				409,
			);
		}
		const updated = await ciphersDb.getCipherById(db, cipher.id);
		if (!updated) {
			console.error(
				JSON.stringify({
					event: "cipher.update_readback_missing",
					cipherId: cipher.id,
					userId: user.id,
				}),
			);
			return errorResponse("Cipher changed while updating", 409);
		}
		return c.json(
			cipherToResponse(
				updated,
				await attachmentsDb.listByCipherIds(db, [updated.id]),
				collectionIds,
			),
		);
	},
);

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
	const cipher = await ciphersDb.getCipherById(db, id);
	if (!cipher) return errorResponse("Cipher changed after restore", 409);
	return c.json(
		cipherToResponse(
			cipher,
			await attachmentsDb.listByCipherIds(db, [cipher.id]),
			await getCipherCollectionIds(db, id),
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
					archived_at: now(),
					updated_at: ts,
					mutation_token: mutationToken,
				})
				.where("id", "=", cipher.id)
				.where("deleted_at", "is", null)
				.where("archived_at", "is", null)
				.where(sql<boolean>`mutation_token IS ${cipher.mutation_token}`)
				.compile(),
			conditionalCipherRevisionQuery(db, cipher.id, mutationToken, ts),
		]);
		if (archived.numAffectedRows !== 1n)
			return errorResponse("Cipher changed during archive", 409);
	}
	const updated = await ciphersDb.getCipherById(db, cipher.id);
	if (!updated) return errorResponse("Cipher changed after archive", 409);
	return c.json(
		cipherToResponse(
			updated,
			await attachmentsDb.listByCipherIds(db, [cipher.id]),
			await getCipherCollectionIds(db, cipher.id),
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
				.where("archived_at", "is not", null)
				.where(sql<boolean>`mutation_token IS ${cipher.mutation_token}`)
				.compile(),
			conditionalCipherRevisionQuery(db, cipher.id, mutationToken, ts),
		]);
		if (unarchived.numAffectedRows !== 1n)
			return errorResponse("Cipher changed during unarchive", 409);
	}
	const updated = await ciphersDb.getCipherById(db, cipher.id);
	if (!updated) return errorResponse("Cipher changed after unarchive", 409);
	return c.json(
		cipherToResponse(
			updated,
			await attachmentsDb.listByCipherIds(db, [cipher.id]),
			await getCipherCollectionIds(db, cipher.id),
		),
	);
});

// POST /api/ciphers/delete (bulk soft delete)
export {
	archiveCiphers,
	deleteCiphers,
	hardDeleteCiphers,
	moveCiphers,
	restoreCiphers,
	unarchiveCiphers,
} from "./ciphers-bulk";

export { importCiphers } from "./ciphers-import";
