import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
	CreateCollectionSchema,
	CreateOrganizationSchema,
	DeleteOrganizationSchema,
	InviteOrganizationMemberSchema,
	UpdateOrganizationMemberSchema,
	OrganizationInviteeQuerySchema,
	UpdateCollectionSchema,
	UpdateOrganizationSchema,
} from "../schemas/organizations";
import { executeBatch, revisionQuery } from "../services/db/batch";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";
import { verifyPassword } from "../services/auth";

function organizationResponse(org: any, member: any) {
	return {
		id: org.id,
		name: org.name,
		key: member.key,
		publicKey: org.public_key,
		privateKey: org.private_key,
		role: member.role,
		status: member.status,
		accessAll: Boolean(member.access_all),
		creationDate: toIso(org.created_at),
		revisionDate: toIso(org.updated_at),
		object: "profileOrganization",
	};
}

function collectionResponse(
	collection: any,
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
	db: any,
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
	return members.map((member: any) =>
		revisionQuery(db, member.user_id!, timestamp),
	);
}

const ROLE_LEVEL: Record<string, number> = {
	member: 0,
	manager: 1,
	admin: 2,
	owner: 3,
};

function canManageRole(actorRole: string, targetRole: string) {
	return (ROLE_LEVEL[actorRole] ?? -1) > (ROLE_LEVEL[targetRole] ?? 99);
}

async function validateCollectionAccess(
	db: any,
	orgId: string,
	accessAll: boolean,
	collections: Array<{ id: string; readOnly: boolean; hidePasswords: boolean }>,
) {
	if (accessAll) return { collections: [] } as const;
	const unique = [
		...new Map(
			collections.map((collection) => [collection.id, collection]),
		).values(),
	];
	if (!unique.length)
		return {
			error: "At least one collection is required for restricted access",
		} as const;
	const rows = await db
		.selectFrom("collections")
		.select("id")
		.where("org_id", "=", orgId)
		.where(
			"id",
			"in",
			unique.map((item) => item.id),
		)
		.execute();
	if (rows.length !== unique.length)
		return { error: "Collection not found" } as const;
	return { collections: unique } as const;
}

export const listOrganizations = factory.createHandlers(async (c) => {
	const rows = await c
		.get("db")
		.selectFrom("org_members as member")
		.innerJoin("organizations as org", "org.id", "member.org_id")
		.select([
			"org.id",
			"org.name",
			"org.public_key",
			"org.private_key",
			"org.created_at",
			"org.updated_at",
			"member.key",
			"member.role",
			"member.status",
			"member.access_all",
		])
		.where("member.user_id", "=", c.get("user").id)
		.where("member.status", "=", "confirmed")
		.execute();
	return c.json({
		data: rows.map((row) => organizationResponse(row, row)),
		object: "list",
		continuationToken: null,
	});
});

export const createOrganization = factory.createHandlers(
	vValidator("json", CreateOrganizationSchema),
	async (c) => {
		const body = c.req.valid("json");
		const db = c.get("db");
		const user = c.get("user");
		if (!user.public_key || !user.private_key)
			return errorResponse("Account encryption keys are required", 409);
		const orgId = crypto.randomUUID();
		const memberId = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.insertInto("organizations")
				.values({
					id: orgId,
					name: body.name,
					owner_id: user.id,
					public_key: body.publicKey ?? null,
					private_key: body.encryptedPrivateKey ?? null,
					created_at: ts,
					updated_at: ts,
				})
				.compile(),
			db
				.insertInto("org_members")
				.values({
					id: memberId,
					org_id: orgId,
					user_id: user.id,
					email: user.email,
					role: "owner",
					status: "confirmed",
					access_all: 1,
					key: body.key,
					created_at: ts,
					updated_at: ts,
				})
				.compile(),
			db
				.insertInto("collections")
				.values({
					id: collectionId,
					org_id: orgId,
					name: body.collectionName,
					created_at: ts,
					updated_at: ts,
				})
				.compile(),
			revisionQuery(db, user.id, ts),
		]);
		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "organization.create",
			category: "org",
			targetType: "organization",
			targetId: orgId,
			metadata: auditRequestMetadata(c.req.raw),
		});
		const org = await db
			.selectFrom("organizations")
			.selectAll()
			.where("id", "=", orgId)
			.executeTakeFirstOrThrow();
		const member = await db
			.selectFrom("org_members")
			.selectAll()
			.where("id", "=", memberId)
			.executeTakeFirstOrThrow();
		return c.json(organizationResponse(org, member), 201);
	},
);

export const getOrganization = factory.createHandlers(async (c) => {
	const org = await c
		.get("db")
		.selectFrom("organizations")
		.selectAll()
		.where("id", "=", c.get("orgMember").org_id)
		.executeTakeFirstOrThrow();
	return c.json(organizationResponse(org, c.get("orgMember")));
});

export const updateOrganization = factory.createHandlers(
	vValidator("json", UpdateOrganizationSchema),
	async (c) => {
		const db = c.get("db");
		const member = c.get("orgMember");
		const ts = now();
		const name = c.req.valid("json").name;
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("organizations")
				.set({ name, updated_at: ts })
				.where("id", "=", member.org_id)
				.compile(),
			...(await memberRevisionQueries(db, member.org_id, ts)),
		]);
		const org = await db
			.selectFrom("organizations")
			.selectAll()
			.where("id", "=", member.org_id)
			.executeTakeFirstOrThrow();
		return c.json(organizationResponse(org, member));
	},
);

export const deleteOrganization = factory.createHandlers(
	vValidator("json", DeleteOrganizationSchema),
	async (c) => {
		const user = c.get("user");
		if (
			!(await verifyPassword(
				c.req.valid("json").masterPasswordHash,
				user.master_password_hash,
				user.email,
			))
		)
			return errorResponse("Master password verification failed", 400);
		const orgId = c.get("orgMember").org_id;
		await c
			.get("db")
			.deleteFrom("organizations")
			.where("id", "=", orgId)
			.execute();
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "organization.delete",
			category: "org",
			level: "warning",
			targetType: "organization",
			targetId: orgId,
			metadata: auditRequestMetadata(c.req.raw),
		});
		return new Response(null, { status: 204 });
	},
);

export const getInviteePublicKey = factory.createHandlers(
	vValidator("query", OrganizationInviteeQuerySchema),
	async (c) => {
		const email = c.req.valid("query").email.trim().toLowerCase();
		const user = await c
			.get("db")
			.selectFrom("users")
			.select(["id", "email", "public_key"])
			.where("email", "=", email)
			.where("status", "=", "active")
			.executeTakeFirst();
		if (!user?.public_key)
			return errorResponse("User is not available for encrypted sharing", 404);
		return c.json({
			id: user.id,
			email: user.email,
			publicKey: user.public_key,
			object: "organizationInvitee",
		});
	},
);

export const listOrganizationMembers = factory.createHandlers(async (c) => {
	const rows = await c
		.get("db")
		.selectFrom("org_members")
		.selectAll()
		.where("org_id", "=", c.get("orgMember").org_id)
		.orderBy("created_at")
		.execute();
	const accessRows = rows.length
		? await c
				.get("db")
				.selectFrom("collection_members")
				.selectAll()
				.where(
					"org_member_id",
					"in",
					rows.map((member) => member.id),
				)
				.execute()
		: [];
	const accessByMember = Map.groupBy(
		accessRows,
		(access) => access.org_member_id,
	);
	return c.json({
		data: rows.map((member) => ({
			id: member.id,
			userId: member.user_id,
			email: member.email,
			role: member.role,
			status: member.status,
			accessAll: Boolean(member.access_all),
			collections: (accessByMember.get(member.id) ?? []).map((access) => ({
				id: access.collection_id,
				readOnly: Boolean(access.read_only),
				hidePasswords: Boolean(access.hide_passwords),
			})),
			creationDate: toIso(member.created_at),
			object: "organizationUser",
		})),
		object: "list",
		continuationToken: null,
	});
});

export const inviteOrganizationMember = factory.createHandlers(
	vValidator("json", InviteOrganizationMemberSchema),
	async (c) => {
		const body = c.req.valid("json");
		const db = c.get("db");
		const orgId = c.get("orgMember").org_id;
		if (!canManageRole(c.get("orgMember").role, body.role))
			return errorResponse(
				"Cannot assign a role equal to or above your own",
				403,
			);
		const access = await validateCollectionAccess(
			db,
			orgId,
			body.accessAll,
			body.collections,
		);
		if ("error" in access && access.error)
			return errorResponse(
				access.error,
				access.error.includes("not found") ? 404 : 400,
			);
		const target = await db
			.selectFrom("users")
			.select(["id", "email", "public_key"])
			.where("email", "=", body.email.toLowerCase())
			.where("status", "=", "active")
			.executeTakeFirst();
		if (!target?.public_key)
			return errorResponse("User is not available for encrypted sharing", 404);
		if (
			await db
				.selectFrom("org_members")
				.select("id")
				.where("org_id", "=", orgId)
				.where("email", "=", target.email)
				.executeTakeFirst()
		)
			return errorResponse("User is already a member", 409);
		const ts = now();
		const memberId = crypto.randomUUID();
		await executeBatch(c.get("dbDialect"), [
			db
				.insertInto("org_members")
				.values({
					id: memberId,
					org_id: orgId,
					user_id: target.id,
					email: target.email,
					role: body.role,
					status: "confirmed",
					access_all: body.accessAll ? 1 : 0,
					key: body.key,
					created_at: ts,
					updated_at: ts,
				})
				.compile(),
			...access.collections.map((item) =>
				db
					.insertInto("collection_members")
					.values({
						collection_id: item.id,
						org_member_id: memberId,
						read_only: item.readOnly ? 1 : 0,
						hide_passwords: item.hidePasswords ? 1 : 0,
					})
					.compile(),
			),
			revisionQuery(db, target.id, ts),
			revisionQuery(db, c.get("user").id, ts),
		]);
		await safeWriteAuditEvent(db, {
			actorUserId: c.get("user").id,
			action: "organization.member.add",
			category: "org",
			targetType: "organizationMember",
			targetId: memberId,
			metadata: {
				...auditRequestMetadata(c.req.raw),
				targetEmail: target.email,
			},
		});
		return c.json(
			{
				id: memberId,
				email: target.email,
				role: body.role,
				status: "confirmed",
				accessAll: body.accessAll,
				object: "organizationUser",
			},
			201,
		);
	},
);

export const updateOrganizationMember = factory.createHandlers(
	vValidator("json", UpdateOrganizationMemberSchema),
	async (c) => {
		const memberId = c.req.param("memberId");
		if (!memberId) return errorResponse("Member not found", 404);
		const db = c.get("db");
		const actor = c.get("orgMember");
		const target = await db
			.selectFrom("org_members")
			.selectAll()
			.where("id", "=", memberId)
			.where("org_id", "=", actor.org_id)
			.executeTakeFirst();
		if (
			!target ||
			target.role === "owner" ||
			!canManageRole(actor.role, target.role)
		)
			return errorResponse("Member not found", 404);
		const body = c.req.valid("json");
		if (!canManageRole(actor.role, body.role))
			return errorResponse(
				"Cannot assign a role equal to or above your own",
				403,
			);
		const access = await validateCollectionAccess(
			db,
			actor.org_id,
			body.accessAll,
			body.collections,
		);
		if ("error" in access && access.error)
			return errorResponse(
				access.error,
				access.error.includes("not found") ? 404 : 400,
			);
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("org_members")
				.set({
					role: body.role,
					access_all: body.accessAll ? 1 : 0,
					updated_at: ts,
				})
				.where("id", "=", target.id)
				.compile(),
			db
				.deleteFrom("collection_members")
				.where("org_member_id", "=", target.id)
				.compile(),
			...access.collections.map((item) =>
				db
					.insertInto("collection_members")
					.values({
						collection_id: item.id,
						org_member_id: target.id,
						read_only: item.readOnly ? 1 : 0,
						hide_passwords: item.hidePasswords ? 1 : 0,
					})
					.compile(),
			),
			...(target.user_id ? [revisionQuery(db, target.user_id, ts)] : []),
		]);
		return c.json({
			id: target.id,
			email: target.email,
			role: body.role,
			status: target.status,
			accessAll: body.accessAll,
			collections: access.collections,
			object: "organizationUser",
		});
	},
);

export const removeOrganizationMember = factory.createHandlers(async (c) => {
	const memberId = c.req.param("memberId");
	if (!memberId) return errorResponse("Member not found", 404);
	const db = c.get("db");
	const target = await db
		.selectFrom("org_members")
		.selectAll()
		.where("id", "=", memberId)
		.where("org_id", "=", c.get("orgMember").org_id)
		.executeTakeFirst();
	if (
		!target ||
		target.role === "owner" ||
		!canManageRole(c.get("orgMember").role, target.role)
	)
		return errorResponse("Member not found", 404);
	await executeBatch(c.get("dbDialect"), [
		db.deleteFrom("org_members").where("id", "=", target.id).compile(),
		...(target.user_id ? [revisionQuery(db, target.user_id)] : []),
	]);
	return new Response(null, { status: 204 });
});

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
	const linked = await db
		.selectFrom("cipher_collections")
		.select("cipher_id")
		.where("collection_id", "=", collection.id)
		.execute();
	if (linked.length) {
		const allLinks = await db
			.selectFrom("cipher_collections")
			.select("cipher_id")
			.where(
				"cipher_id",
				"in",
				linked.map((item: any) => item.cipher_id),
			)
			.execute();
		const linkCounts = Map.groupBy(allLinks, (item: any) => item.cipher_id);
		if (
			linked.some(
				(item: any) => (linkCounts.get(item.cipher_id)?.length ?? 0) < 2,
			)
		)
			return errorResponse(
				"Move or delete items that only belong to this collection first",
				409,
			);
	}
	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db.deleteFrom("collections").where("id", "=", collection.id).compile(),
		...(await memberRevisionQueries(db, collection.org_id, ts)),
	]);
	return new Response(null, { status: 204 });
});
