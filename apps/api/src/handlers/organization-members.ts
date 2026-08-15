import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { factory } from "../http/factory";
import {
	InviteOrganizationMemberSchema,
	OrganizationInviteeQuerySchema,
	UpdateOrganizationMemberSchema,
} from "../schemas/organizations";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import {
	conditionalOrganizationMemberRevisionQuery,
	organizationMemberCollectionAccessQuery,
	organizationMemberInvitationRevisionQuery,
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
				manage: Boolean(access.manage),
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
		const ts = now();
		const memberId = crypto.randomUUID();
		const actor = c.get("orgMember");
		const mutationToken = crypto.randomUUID();
		const collectionIds = JSON.stringify(
			access.collections.map((item) => item.id),
		);
		const [inserted] = await c.get("dbDialect").batch([
			db
				.insertInto("org_members")
				.columns([
					"id",
					"org_id",
					"user_id",
					"email",
					"role",
					"status",
					"access_all",
					"key",
					"created_at",
					"updated_at",
					"mutation_token",
				])
				.expression(
					db
						.selectFrom("users as target_user")
						.select([
							sql<string>`${memberId}`.as("id"),
							sql<string>`${orgId}`.as("org_id"),
							"target_user.id as user_id",
							"target_user.email",
							sql<string>`${body.role}`.as("role"),
							sql<string>`'confirmed'`.as("status"),
							sql<number>`${body.accessAll ? 1 : 0}`.as("access_all"),
							sql<string>`${body.key}`.as("key"),
							sql<number>`${ts}`.as("created_at"),
							sql<number>`${ts}`.as("updated_at"),
							sql<string>`${mutationToken}`.as("mutation_token"),
						])
						.where("target_user.id", "=", target.id)
						.where("target_user.email", "=", target.email)
						.where("target_user.status", "=", "active")
						.where("target_user.public_key", "=", target.public_key)
						.where((eb) =>
							eb.exists(
								db
									.selectFrom("org_members as current_actor")
									.select("current_actor.id")
									.where("current_actor.id", "=", actor.id)
									.where("current_actor.org_id", "=", orgId)
									.where("current_actor.role", "=", actor.role)
									.where("current_actor.status", "=", "confirmed")
									.where(
										sql<boolean>`current_actor.mutation_token IS ${actor.mutation_token}`,
									),
							),
						)
						.where(sql<boolean>`not exists (
							select 1 from org_members existing
							where existing.org_id = ${orgId}
							  and existing.email = ${target.email}
						)`)
						.$if(!body.accessAll, (query) =>
							query.where(sql<boolean>`not exists (
								select 1 from json_each(${collectionIds}) requested
								where not exists (
									select 1 from collections collection
									where collection.id = requested.value
									  and collection.org_id = ${orgId}
								)
							)`),
						),
				)
				.compile(),
			...access.collections.map((item) =>
				organizationMemberCollectionAccessQuery(
					db,
					memberId,
					item.id,
					item.readOnly,
					item.hidePasswords,
					mutationToken,
				),
			),
			organizationMemberInvitationRevisionQuery(
				db,
				memberId,
				c.get("user").id,
				mutationToken,
				ts,
			),
			auditEventInsertQuery(
				db,
				{
					actorUserId: c.get("user").id,
					action: "organization.member.add",
					category: "org",
					targetType: "organizationMember",
					targetId: memberId,
					metadata: {
						...auditRequestMetadata(c.req.raw),
						targetEmail: target.email,
					},
				},
				sql<boolean>`EXISTS (
					SELECT 1 FROM org_members
					WHERE id = ${memberId} AND mutation_token = ${mutationToken}
				)`,
				ts,
			),
		]);
		if (inserted.numAffectedRows !== 1n)
			return errorResponse("Member invitation changed or already exists", 409);
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
		const mutationToken = crypto.randomUUID();
		const collectionIds = JSON.stringify(
			access.collections.map((item) => item.id),
		);
		const [updated] = await c.get("dbDialect").batch([
			db
				.updateTable("org_members")
				.set({
					role: body.role,
					access_all: body.accessAll ? 1 : 0,
					updated_at: ts,
					mutation_token: mutationToken,
				})
				.where("id", "=", target.id)
				.where("org_id", "=", actor.org_id)
				.where(sql<boolean>`mutation_token IS ${target.mutation_token}`)
				.where((eb) =>
					eb.exists(
						db
							.selectFrom("org_members as current_actor")
							.select("current_actor.id")
							.where("current_actor.id", "=", actor.id)
							.where("current_actor.org_id", "=", actor.org_id)
							.where("current_actor.role", "=", actor.role)
							.where("current_actor.status", "=", "confirmed")
							.where(
								sql<boolean>`current_actor.mutation_token IS ${actor.mutation_token}`,
							),
					),
				)
				.$if(!body.accessAll, (query) =>
					query.where(sql<boolean>`not exists (
						select 1 from json_each(${collectionIds}) requested
						where not exists (
							select 1 from collections collection
							where collection.id = requested.value
							  and collection.org_id = ${actor.org_id}
						)
					)`),
				)
				.compile(),
			db
				.deleteFrom("collection_members")
				.where("org_member_id", "=", target.id)
				.where((eb) =>
					eb.exists(
						db
							.selectFrom("org_members")
							.select("id")
							.where("id", "=", target.id)
							.where("mutation_token", "=", mutationToken),
					),
				)
				.compile(),
			...access.collections.map((item) =>
				organizationMemberCollectionAccessQuery(
					db,
					target.id,
					item.id,
					item.readOnly,
					item.hidePasswords,
					mutationToken,
				),
			),
			conditionalOrganizationMemberRevisionQuery(
				db,
				target.id,
				mutationToken,
				ts,
			),
		]);
		if (updated.numAffectedRows !== 1n)
			return errorResponse("Member permissions changed concurrently", 409);
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
	const actor = c.get("orgMember");
	const mutationToken = crypto.randomUUID();
	const [claimed, , , removed] = await c.get("dbDialect").batch([
		db
			.updateTable("org_members")
			.set({ mutation_token: mutationToken })
			.where("id", "=", target.id)
			.where("org_id", "=", actor.org_id)
			.where(sql<boolean>`mutation_token IS ${target.mutation_token}`)
			.where((eb) =>
				eb.exists(
					db
						.selectFrom("org_members as current_actor")
						.select("current_actor.id")
						.where("current_actor.id", "=", actor.id)
						.where("current_actor.org_id", "=", actor.org_id)
						.where("current_actor.role", "=", actor.role)
						.where("current_actor.status", "=", "confirmed")
						.where(
							sql<boolean>`current_actor.mutation_token IS ${actor.mutation_token}`,
						),
				),
			)
			.compile(),
		conditionalOrganizationMemberRevisionQuery(db, target.id, mutationToken),
		auditEventInsertQuery(
			db,
			{
				actorUserId: c.get("user").id,
				action: "organization.member.delete",
				category: "org",
				level: "warning",
				targetType: "organizationMember",
				targetId: target.id,
				metadata: auditRequestMetadata(c.req.raw),
			},
			sql<boolean>`EXISTS (
				SELECT 1 FROM org_members
				WHERE id = ${target.id}
				  AND org_id = ${actor.org_id}
				  AND mutation_token = ${mutationToken}
			)`,
		),
		db
			.deleteFrom("org_members")
			.where("id", "=", target.id)
			.where("org_id", "=", actor.org_id)
			.where("mutation_token", "=", mutationToken)
			.compile(),
	]);
	// D1 may include cascaded collection_members rows in the DELETE change
	// count. The claim must affect exactly one member; the final delete only
	// needs to prove that claimed row was removed.
	if (
		claimed.numAffectedRows !== 1n ||
		Number(removed.numAffectedRows ?? 0n) < 1
	)
		return errorResponse("Member changed during removal", 409);
	return new Response(null, { status: 204 });
});
