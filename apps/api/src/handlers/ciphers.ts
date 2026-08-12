import { vValidator } from "@hono/valibot-validator";
import { type CompiledQuery, sql } from "kysely";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { CipherSchema } from "../schemas/ciphers";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import {
	getCipherCollectionIds,
	getCipherPermissions,
	revisionQueriesForCipher,
	revisionUserIdsForCipher,
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
		return c.json(cipherToResponse(created!, [], collectionIds), 200);
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
			.where("updated_at", "=", ts);
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
			...(await revisionUserIdsForCipher(db, cipher)).map((userId) =>
				sql`
					INSERT INTO user_revisions (user_id, revision_date)
					SELECT ${userId}, ${ts}
					WHERE EXISTS (
						SELECT 1 FROM ciphers
						WHERE id = ${cipher.id} AND updated_at = ${ts}
					)
					ON CONFLICT (user_id) DO UPDATE
					SET revision_date = excluded.revision_date
				`.compile(db),
			),
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
		return c.json(
			cipherToResponse(
				updated!,
				await attachmentsDb.listByCipherIds(db, [updated!.id]),
				collectionIds,
			),
		);
	},
);

// DELETE /api/ciphers/:id (soft delete, Bitwarden compat)
export const deleteCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("ciphers")
			.set({
				deleted_at: ts,
				purge_after: ts + LIMITS.cipher.trashRetentionSeconds,
				updated_at: ts,
			})
			.where("id", "=", cipher.id)
			.compile(),
		...(await revisionQueriesForCipher(db, cipher, ts)),
	]);
	await safeWriteAuditEvent(db, {
		actorUserId: c.get("user").id,
		action: "cipher.delete",
		category: "vault",
		targetType: "cipher",
		targetId: cipher.id,
		metadata: auditRequestMetadata(c.req.raw),
	});
	return new Response(null, { status: 200 });
});

// PUT /api/ciphers/:id/delete (soft delete)
export const putDeleteCipher = deleteCipher;

// DELETE /api/ciphers/:id/delete (hard delete)
export const hardDeleteCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	const cipherId = cipher.id;
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("ciphers")
			.set({ deleted_at: ts, purge_after: ts, updated_at: ts })
			.where("id", "=", cipherId)
			.compile(),
		...(await revisionQueriesForCipher(db, cipher, ts)),
	]);
	await safeWriteAuditEvent(db, {
		actorUserId: c.get("user").id,
		action: "cipher.delete.permanent",
		category: "vault",
		level: "warning",
		targetType: "cipher",
		targetId: cipherId,
		metadata: auditRequestMetadata(c.req.raw),
	});
	return new Response(null, { status: 200 });
});

// PUT /api/ciphers/:id/restore
export const restoreCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const existing = c.get("cipher");
	const id = existing.id;
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("ciphers")
			.set({ deleted_at: null, purge_after: null, updated_at: ts })
			.where("id", "=", id)
			.compile(),
		...(await revisionQueriesForCipher(db, existing, ts)),
	]);
	const cipher = await ciphersDb.getCipherById(db, id);
	return c.json(
		cipherToResponse(
			cipher!,
			await attachmentsDb.listByCipherIds(db, [cipher!.id]),
			await getCipherCollectionIds(db, id),
		),
	);
});

export const archiveCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	if (cipher.deleted_at)
		return errorResponse("Cannot archive a deleted cipher", 400);
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("ciphers")
			.set({ archived_at: ts, updated_at: ts })
			.where("id", "=", cipher.id)
			.compile(),
		...(await revisionQueriesForCipher(db, cipher, ts)),
	]);
	const updated = await ciphersDb.getCipherById(db, cipher.id);
	return c.json(
		cipherToResponse(
			updated!,
			await attachmentsDb.listByCipherIds(db, [cipher.id]),
			await getCipherCollectionIds(db, cipher.id),
		),
	);
});

export const unarchiveCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("ciphers")
			.set({ archived_at: null, updated_at: ts })
			.where("id", "=", cipher.id)
			.compile(),
		...(await revisionQueriesForCipher(db, cipher, ts)),
	]);
	const updated = await ciphersDb.getCipherById(db, cipher.id);
	return c.json(
		cipherToResponse(
			updated!,
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
