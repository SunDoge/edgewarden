import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
	InviteOrganizationMemberSchema,
	OrganizationInviteeQuerySchema,
	UpdateOrganizationMemberSchema,
} from "../schemas/organizations";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import {
	executeBatch,
	organizationMemberCollectionAccessQuery,
	organizationMemberRevisionQuery,
	revisionQuery,
} from "../services/db/batch";
import { textColumnInJson } from "../services/db/json-array";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";

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
	if (!unique.length) {
		return {
			error: "At least one collection is required for restricted access",
		} as const;
	}
	const rows = await db
		.selectFrom("collections")
		.select("id")
		.where("org_id", "=", orgId)
		.where(
			textColumnInJson(
				"id",
				unique.map((item) => item.id),
			),
		)
		.execute();
	if (rows.length !== unique.length) {
		return { error: "Collection not found" } as const;
	}
	return { collections: unique } as const;
}

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
		if (!user?.public_key) {
			return errorResponse("User is not available for encrypted sharing", 404);
		}
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
					textColumnInJson(
						"org_member_id",
						rows.map((member) => member.id),
					),
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
		if (!canManageRole(c.get("orgMember").role, body.role)) {
			return errorResponse(
				"Cannot assign a role equal to or above your own",
				403,
			);
		}
		const access = await validateCollectionAccess(
			db,
			orgId,
			body.accessAll,
			body.collections,
		);
		if ("error" in access && access.error) {
			return errorResponse(
				access.error,
				access.error.includes("not found") ? 404 : 400,
			);
		}
		const target = await db
			.selectFrom("users")
			.select(["id", "email", "public_key"])
			.where("email", "=", body.email.toLowerCase())
			.where("status", "=", "active")
			.executeTakeFirst();
		if (!target?.public_key) {
			return errorResponse("User is not available for encrypted sharing", 404);
		}
		if (
			await db
				.selectFrom("org_members")
				.select("id")
				.where("org_id", "=", orgId)
				.where("email", "=", target.email)
				.executeTakeFirst()
		) {
			return errorResponse("User is already a member", 409);
		}
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
		) {
			return errorResponse("Member not found", 404);
		}
		const body = c.req.valid("json");
		if (!canManageRole(actor.role, body.role)) {
			return errorResponse(
				"Cannot assign a role equal to or above your own",
				403,
			);
		}
		const access = await validateCollectionAccess(
			db,
			actor.org_id,
			body.accessAll,
			body.collections,
		);
		if ("error" in access && access.error) {
			return errorResponse(
				access.error,
				access.error.includes("not found") ? 404 : 400,
			);
		}
		const ts = now();
		const [updated] = await c.get("dbDialect").batch([
			db
				.updateTable("org_members")
				.set({
					role: body.role,
					access_all: body.accessAll ? 1 : 0,
					updated_at: ts,
				})
				.where("id", "=", target.id)
				.where("org_id", "=", actor.org_id)
				.compile(),
			db
				.deleteFrom("collection_members")
				.where("org_member_id", "=", target.id)
				.compile(),
			...access.collections.map((item) =>
				organizationMemberCollectionAccessQuery(
					db,
					target.id,
					item.id,
					item.readOnly,
					item.hidePasswords,
				),
			),
			organizationMemberRevisionQuery(db, target.id, ts),
		]);
		if (updated.numAffectedRows !== 1n)
			return errorResponse("Member not found", 404);
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
	) {
		return errorResponse("Member not found", 404);
	}
	const [, removed] = await c
		.get("dbDialect")
		.batch([
			organizationMemberRevisionQuery(db, target.id),
			db
				.deleteFrom("org_members")
				.where("id", "=", target.id)
				.where("org_id", "=", c.get("orgMember").org_id)
				.compile(),
		]);
	if (removed.numAffectedRows !== 1n)
		return errorResponse("Member not found", 404);
	return new Response(null, { status: 204 });
});
