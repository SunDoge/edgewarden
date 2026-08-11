import { vValidator } from "@hono/valibot-validator";
import type { CompiledQuery, Selectable } from "kysely";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import {
	BulkIdsSchema,
	CipherImportSchema,
	CipherSchema,
} from "../schemas/ciphers";
import {
	executeBatch,
	executeBatchInChunks,
	revisionQuery,
} from "../services/db/batch";
import * as ciphersDb from "../services/db/ciphers";
import * as attachmentsDb from "../services/db/attachments";
import * as foldersDb from "../services/db/folders";
import { deleteBlobObject, getAttachmentObjectKey } from "../services/blob-store";
import type { Attachments, Ciphers } from "../types/db";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";

function cipherToResponse(cipher: Selectable<Ciphers>, attachments: Selectable<Attachments>[] = [], collectionIds: string[] = []) {
	const data = JSON.parse(cipher.data) as Record<string, unknown>;
	return {
		id: cipher.id,
		organizationId: cipher.org_id ?? null,
		folderId: cipher.folder_id ?? null,
		type: cipher.type,
		name: cipher.name,
		notes: cipher.notes ?? null,
		fields: cipher.fields ? JSON.parse(cipher.fields) : (data.fields ?? null),
		login: cipher.type === 1 ? (data.login ?? null) : null,
		secureNote: cipher.type === 2 ? (data.secureNote ?? null) : null,
		card: cipher.type === 3 ? (data.card ?? null) : null,
		identity: cipher.type === 4 ? (data.identity ?? null) : null,
		sshKey: cipher.type === 5 ? (data.sshKey ?? null) : null,
		bankAccount: cipher.type === 6 ? (data.bankAccount ?? null) : null,
		driversLicense: cipher.type === 7 ? (data.driversLicense ?? null) : null,
		passport: cipher.type === 8 ? (data.passport ?? null) : null,
		favorite: cipher.favorite === 1,
		reprompt: cipher.reprompt ?? 0,
		key: cipher.key ?? null,
		attachments: attachments.map((attachment) => ({ id: attachment.id, fileName: attachment.file_name, size: attachment.size, sizeName: attachment.size_name, key: attachment.key, object: "attachment" })),
		organizationUseTotp: false,
		collectionIds,
		revisionDate: toIso(cipher.updated_at),
		creationDate: toIso(cipher.created_at),
		deletedDate: cipher.deleted_at ? toIso(cipher.deleted_at) : null,
		archivedDate: cipher.archived_at ? toIso(cipher.archived_at) : null,
		passwordHistory: cipher.password_history
			? JSON.parse(cipher.password_history)
			: (data.passwordHistory ?? null),
		object: "cipher",
	};
}

async function getCipherCollectionIds(db: any, cipherId: string): Promise<string[]> {
	return (await db.selectFrom("cipher_collections").select("collection_id").where("cipher_id", "=", cipherId).execute()).map((row: any) => row.collection_id);
}

async function revisionQueriesForCipher(db: any, cipher: Pick<Selectable<Ciphers>, "user_id" | "org_id">, timestamp = now()): Promise<CompiledQuery[]> {
	if (cipher.user_id) return [revisionQuery(db, cipher.user_id, timestamp)];
	const members = await db.selectFrom("org_members").select("user_id").where("org_id", "=", cipher.org_id!).where("status", "=", "confirmed").where("user_id", "is not", null).execute();
	return members.map((member: any) => revisionQuery(db, member.user_id, timestamp));
}

async function validateOrganizationCollections(db: any, userId: string, organizationId: string, collectionIds: string[]) {
	const uniqueIds = [...new Set(collectionIds)];
	if (!uniqueIds.length) return { error: "At least one collection is required" } as const;
	const member = await db.selectFrom("org_members").selectAll().where("org_id", "=", organizationId).where("user_id", "=", userId).where("status", "=", "confirmed").executeTakeFirst();
	if (!member) return { error: "Organization not found" } as const;
	const collections = await db.selectFrom("collections").select("id").where("org_id", "=", organizationId).where("id", "in", uniqueIds).execute();
	if (collections.length !== uniqueIds.length) return { error: "Collection not found" } as const;
	const elevated = ["manager", "admin", "owner"].includes(member.role);
	if (!elevated && !member.access_all) {
		const writable = await db.selectFrom("collection_members").select("collection_id").where("org_member_id", "=", member.id).where("collection_id", "in", uniqueIds).where("read_only", "=", 0).execute();
		if (writable.length !== uniqueIds.length) return { error: "Collection is read-only" } as const;
	}
	return { member, collectionIds: uniqueIds } as const;
}

async function deleteAttachmentObjects(env: CloudflareBindings, attachments: Selectable<Attachments>[]) {
	await Promise.allSettled(attachments.map((attachment) => deleteBlobObject(env, getAttachmentObjectKey(attachment.cipher_id, attachment.id))));
}

type CipherBody = {
	login?: Record<string, unknown> | null;
	secureNote?: Record<string, unknown> | null;
	card?: Record<string, unknown> | null;
	identity?: Record<string, unknown> | null;
	sshKey?: Record<string, unknown> | null;
	bankAccount?: Record<string, unknown> | null;
	driversLicense?: Record<string, unknown> | null;
	passport?: Record<string, unknown> | null;
	fields?: unknown[] | null;
	passwordHistory?: unknown[] | null;
};

function buildCipherData(body: CipherBody) {
	// Store everything except server-managed fields in the JSON data column
	const data: Record<string, unknown> = {};
	if (body.login) data.login = body.login;
	if (body.secureNote) data.secureNote = body.secureNote;
	if (body.card) data.card = body.card;
	if (body.identity) data.identity = body.identity;
	if (body.sshKey) data.sshKey = body.sshKey;
	if (body.bankAccount) data.bankAccount = body.bankAccount;
	if (body.driversLicense) data.driversLicense = body.driversLicense;
	if (body.passport) data.passport = body.passport;
	return JSON.stringify(data);
}

// GET /api/ciphers
export const listCiphers = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const db = c.get("db");
	const ciphers = await ciphersDb.getCiphersByUserId(db, user.id);
	const attachments = await attachmentsDb.listByCipherIds(db, ciphers.map((cipher) => cipher.id));
	const attachmentsByCipher = Map.groupBy(attachments, (attachment) => attachment.cipher_id);
	return c.json({
		data: ciphers.map((cipher) => cipherToResponse(cipher, attachmentsByCipher.get(cipher.id))),
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
		if (!organizationId && collectionIds.length) return errorResponse("Personal ciphers cannot use collections", 400);
		if (organizationId && body.folderId) return errorResponse("Organization ciphers cannot use folders", 400);
		if (!organizationId &&
			body.folderId &&
			!(await foldersDb.getFolderById(db, body.folderId, user.id))
		) {
			return errorResponse("Folder not found", 400);
		}

		const access = organizationId ? await validateOrganizationCollections(db, user.id, organizationId, collectionIds) : null;
		if (access && "error" in access && access.error) return errorResponse(access.error, access.error.includes("not found") ? 404 : 403);
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
		const owner = { user_id: organizationId ? null : user.id, org_id: organizationId };
		await executeBatch(c.get("dbDialect"), [
			db.insertInto("ciphers").values(values).compile(),
			...collectionIds.map((collectionId) => db.insertInto("cipher_collections").values({ cipher_id: id, collection_id: collectionId }).compile()),
			...(await revisionQueriesForCipher(db, owner, ts)),
		]);

		const created = await ciphersDb.getCipherById(db, id);
		return c.json(cipherToResponse(created!, [], collectionIds), 200);
	},
);

// POST /api/ciphers/import
export const importCiphers = factory.createHandlers(
	vValidator("json", CipherImportSchema),
	async (c) => {
		const user = c.get("user");
		const db = c.get("db");
		const returnCipherMap = c.req.query("returnCipherMap") === "1";

		const { folders, ciphers, folderRelationships } = c.req.valid("json");

		if (folders.length + ciphers.length > LIMITS.performance.importItemLimit) {
			return errorResponse(
				`Import exceeds maximum of ${LIMITS.performance.importItemLimit} items`,
				400,
			);
		}

		const nowTime = now();
		const batchChunkSize = LIMITS.performance.bulkMoveChunkSize;

		// Create folders and build index -> id mapping
		const folderIdMap = new Map<number, string>();
		const queries: CompiledQuery[] = [];

		for (let i = 0; i < folders.length; i++) {
			const folderId = crypto.randomUUID();
			folderIdMap.set(i, folderId);

			queries.push(
				db
					.insertInto("folders")
					.values({
						id: folderId,
						user_id: user.id,
						name: folders[i].name,
						created_at: nowTime,
						updated_at: nowTime,
					})
					.compile(),
			);
		}

		// Build cipher index -> folder id mapping from relationships
		const cipherFolderMap = new Map<number, string>();
		for (const rel of folderRelationships) {
			const folderId = folderIdMap.get(rel.value);
			if (folderId) {
				cipherFolderMap.set(rel.key, folderId);
			}
		}

		// Create ciphers
		const cipherMapRows: Array<{
			index: number;
			sourceId: string | null;
			id: string;
		}> = [];

		for (let i = 0; i < ciphers.length; i++) {
			const cItem = ciphers[i];
			const folderId = cipherFolderMap.get(i) || cItem.folderId || null;
			const sourceId = cItem.id ? String(cItem.id).trim() || null : null;
			const cipherId = crypto.randomUUID();

			queries.push(
				db
					.insertInto("ciphers")
					.values({
						id: cipherId,
						user_id: user.id,
						org_id: null,
						type: cItem.type,
						folder_id: folderId,
						name: cItem.name,
						notes: cItem.notes ?? null,
						favorite: cItem.favorite ? 1 : 0,
						data: buildCipherData(cItem),
						fields: cItem.fields ? JSON.stringify(cItem.fields) : null,
						password_history: cItem.passwordHistory
							? JSON.stringify(cItem.passwordHistory)
							: null,
						reprompt: cItem.reprompt ?? 0,
						key: cItem.key ?? null,
						created_at: nowTime,
						updated_at: nowTime,
					})
					.compile(),
			);

			cipherMapRows.push({ index: i, sourceId, id: cipherId });
		}

		queries.push(revisionQuery(db, user.id, nowTime));
		await executeBatchInChunks(c.get("dbDialect"), queries, batchChunkSize);

		if (returnCipherMap) {
			return c.json({
				object: "import-result",
				cipherMap: cipherMapRows,
			});
		}

		return new Response(null, { status: 200 });
	},
);

// GET /api/ciphers/:id
export const getCipher = factory.createHandlers(async (c) => {
	const cipher = c.get("cipher");
	return c.json(cipherToResponse(cipher, await attachmentsDb.listByCipherIds(c.get("db"), [cipher.id]), await getCipherCollectionIds(c.get("db"), cipher.id)));
});

// PUT /api/ciphers/:id
export const updateCipher = factory.createHandlers(
	vValidator("json", CipherSchema),
	async (c) => {
		const body = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");
		const cipher = c.get("cipher");
		if ((body.organizationId ?? null) !== (cipher.org_id ?? null)) return errorResponse("Cipher ownership cannot be changed", 400);
		const collectionIds = body.collectionIds ?? [];
		if (cipher.org_id && body.folderId) return errorResponse("Organization ciphers cannot use folders", 400);
		if (!cipher.org_id && collectionIds.length) return errorResponse("Personal ciphers cannot use collections", 400);
		if (!cipher.org_id &&
			body.folderId &&
			!(await foldersDb.getFolderById(db, body.folderId, user.id))
		) {
			return errorResponse("Folder not found", 400);
		}
		if (cipher.org_id) {
			const access = await validateOrganizationCollections(db, user.id, cipher.org_id, collectionIds);
			if ("error" in access && access.error) return errorResponse(access.error, access.error.includes("not found") ? 404 : 403);
		}

		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
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
				.compile(),
			db.deleteFrom("cipher_collections").where("cipher_id", "=", cipher.id).compile(),
			...collectionIds.map((collectionId) => db.insertInto("cipher_collections").values({ cipher_id: cipher.id, collection_id: collectionId }).compile()),
			...(await revisionQueriesForCipher(db, cipher, ts)),
		]);

		const updated = await ciphersDb.getCipherById(db, cipher.id);
		return c.json(cipherToResponse(updated!, await attachmentsDb.listByCipherIds(db, [updated!.id]), collectionIds));
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
	return new Response(null, { status: 200 });
});

// PUT /api/ciphers/:id/delete (soft delete)
export const putDeleteCipher = deleteCipher;

// DELETE /api/ciphers/:id/delete (hard delete)
export const hardDeleteCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	const cipherId = cipher.id;
	const attachments = await attachmentsDb.listByCipherIds(db, [cipherId]);
	await executeBatch(c.get("dbDialect"), [
		db
			.deleteFrom("ciphers")
			.where("id", "=", cipherId)
			.compile(),
		...(await revisionQueriesForCipher(db, cipher)),
	]);
	await deleteAttachmentObjects(c.env, attachments);
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
	return c.json(cipherToResponse(cipher!, await attachmentsDb.listByCipherIds(db, [cipher!.id]), await getCipherCollectionIds(db, id)));
});

export const archiveCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	if (cipher.deleted_at) return errorResponse("Cannot archive a deleted cipher", 400);
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db.updateTable("ciphers").set({ archived_at: ts, updated_at: ts }).where("id", "=", cipher.id).compile(),
		...(await revisionQueriesForCipher(db, cipher, ts)),
	]);
	const updated = await ciphersDb.getCipherById(db, cipher.id);
	return c.json(cipherToResponse(updated!, await attachmentsDb.listByCipherIds(db, [cipher.id]), await getCipherCollectionIds(db, cipher.id)));
});

export const unarchiveCipher = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const cipher = c.get("cipher");
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db.updateTable("ciphers").set({ archived_at: null, updated_at: ts }).where("id", "=", cipher.id).compile(),
		...(await revisionQueriesForCipher(db, cipher, ts)),
	]);
	const updated = await ciphersDb.getCipherById(db, cipher.id);
	return c.json(cipherToResponse(updated!, await attachmentsDb.listByCipherIds(db, [cipher.id]), await getCipherCollectionIds(db, cipher.id)));
});

// POST /api/ciphers/delete (bulk soft delete)
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
				.where("id", "in", ids)
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id, ts),
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
		const ownedIds = (await db.selectFrom("ciphers").select("id").where("id", "in", ids).where("user_id", "=", user.id).execute()).map((cipher) => cipher.id);
		const attachments = await attachmentsDb.listByCipherIds(db, ownedIds);
		await executeBatch(c.get("dbDialect"), [
			db
				.deleteFrom("ciphers")
				.where("id", "in", ids)
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
			db.updateTable("ciphers").set({ archived_at: ts, updated_at: ts }).where("id", "in", ids).where("user_id", "=", user.id).where("deleted_at", "is", null).compile(),
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
			db.updateTable("ciphers").set({ archived_at: null, updated_at: ts }).where("id", "in", ids).where("user_id", "=", user.id).compile(),
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
				.where("id", "in", ids)
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id, ts),
		]);
		return new Response(null, { status: 200 });
	},
);
