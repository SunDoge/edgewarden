import { vValidator } from "@hono/valibot-validator";
import { type Kysely, sql } from "kysely";
import { factory } from "../http/factory";
import {
	CreateCollectionSchema,
	UpdateCollectionSchema,
} from "../schemas/organizations";
import { executeBatch, revisionQuery } from "../services/db/batch";
import type { DB } from "../types/db";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";

function collectionResponse(
	collection: {
		id: string;
		org_id: string;
		name: string;
		created_at: number;
		updated_at: number;
	},
	readOnly = false,
	hidePasswords = false,
) {
	return {
		id: collection.id,
		organizationId: collection.org_id,
		name: collection.name,
		readOnly,
		hidePasswords,
		creationDate: toIso(collection.created_at),
		revisionDate: toIso(collection.updated_at),
		object: "collectionDetails",
	};
}

async function memberRevisionQueries(
	db: Kysely<DB>,
	orgId: string,
	timestamp = now(),
) {
	const members = await db
		.selectFrom("org_members")
		.select("user_id")
		.where("org_id", "=", orgId)
		.where("status", "=", "confirmed")
		.where("user_id", "is not", null)
		.execute();
	return members.map((member) =>
		revisionQuery(db, member.user_id as string, timestamp),
	);
}

export const listCollections = factory.createHandlers(async (c) => {
	const member = c.get("orgMember");
	let query = c
		.get("db")
		.selectFrom("collections as collection")
		.leftJoin("collection_members as access", (join) =>
			join
				.onRef("access.collection_id", "=", "collection.id")
				.on("access.org_member_id", "=", member.id),
		)
		.select([
			"collection.id",
			"collection.org_id",
			"collection.name",
			"collection.created_at",
			"collection.updated_at",
			"access.read_only",
			"access.hide_passwords",
		])
		.where("collection.org_id", "=", member.org_id);
	if (!member.access_all)
		query = query.where("access.org_member_id", "=", member.id);
	const rows = await query.execute();
	return c.json({
		data: rows.map((row) =>
			collectionResponse(
				row,
				Boolean(row.read_only),
				Boolean(row.hide_passwords),
			),
		),
		object: "list",
		continuationToken: null,
	});
});

export const listUserCollections = factory.createHandlers(async (c) => {
	const rows = await c
		.get("db")
		.selectFrom("org_members as member")
		.innerJoin(
			"collections as collection",
			"collection.org_id",
			"member.org_id",
		)
		.leftJoin("collection_members as access", (join) =>
			join
				.onRef("access.collection_id", "=", "collection.id")
				.onRef("access.org_member_id", "=", "member.id"),
		)
		.select([
			"collection.id",
			"collection.org_id",
			"collection.name",
			"collection.created_at",
			"collection.updated_at",
			"access.read_only",
			"access.hide_passwords",
		])
		.where("member.user_id", "=", c.get("user").id)
		.where("member.status", "=", "confirmed")
		.where((eb) =>
			eb.or([
				eb("member.access_all", "=", 1),
				eb("access.org_member_id", "=", eb.ref("member.id")),
			]),
		)
		.execute();
	return c.json({
		data: rows.map((row) =>
			collectionResponse(
				row,
				Boolean(row.read_only),
				Boolean(row.hide_passwords),
			),
		),
		object: "list",
		continuationToken: null,
	});
});

export const createCollection = factory.createHandlers(
	vValidator("json", CreateCollectionSchema),
	async (c) => {
		const db = c.get("db");
		const orgId = c.get("orgMember").org_id;
		const id = crypto.randomUUID();
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.insertInto("collections")
				.values({
					id,
					org_id: orgId,
					name: c.req.valid("json").name,
					created_at: ts,
					updated_at: ts,
				})
				.compile(),
			...(await memberRevisionQueries(db, orgId, ts)),
		]);
		return c.json(
			collectionResponse({
				id,
				org_id: orgId,
				name: c.req.valid("json").name,
				created_at: ts,
				updated_at: ts,
			}),
			201,
		);
	},
);

export const updateCollection = factory.createHandlers(
	vValidator("json", UpdateCollectionSchema),
	async (c) => {
		const collection = c.get("collection");
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			c
				.get("db")
				.updateTable("collections")
				.set({ name: c.req.valid("json").name, updated_at: ts })
				.where("id", "=", collection.id)
				.compile(),
			...(await memberRevisionQueries(c.get("db"), collection.org_id, ts)),
		]);
		return c.json(
			collectionResponse({
				...collection,
				name: c.req.valid("json").name,
				updated_at: ts,
			}),
		);
	},
);

export const deleteCollection = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const collection = c.get("collection");
	const exclusivelyLinkedCipher = await db
		.selectFrom("cipher_collections as current_link")
		.select("current_link.cipher_id")
		.where("current_link.collection_id", "=", collection.id)
		.where(
			sql<boolean>`not exists (
				select 1
				from cipher_collections as other_link
				where other_link.cipher_id = current_link.cipher_id
					and other_link.collection_id <> ${collection.id}
			)`,
		)
		.limit(1)
		.executeTakeFirst();
	if (exclusivelyLinkedCipher)
		return errorResponse(
			"Move or delete items that only belong to this collection first",
			409,
		);
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db.deleteFrom("collections").where("id", "=", collection.id).compile(),
		...(await memberRevisionQueries(db, collection.org_id, ts)),
	]);
	return new Response(null, { status: 204 });
});
