import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { factory } from "../http/factory";
import {
	CreateOrganizationSchema,
	DeleteOrganizationSchema,
	UpdateOrganizationSchema,
} from "../schemas/organizations";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import { verifyPassword } from "../services/auth";
import {
	conditionalOrganizationRevisionQuery,
	executeBatch,
	revisionQuery,
} from "../services/db/batch";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";

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
		.where("org.deletion_requested_at", "is", null)
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
		if (!user.public_key || !user.private_key) {
			return errorResponse("Account encryption keys are required", 409);
		}
		const orgId = crypto.randomUUID();
		const memberId = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db.insertInto("organizations").values({
				id: orgId,
				name: body.name,
				public_key: body.publicKey ?? null,
				private_key: body.encryptedPrivateKey ?? null,
				created_at: ts,
				updated_at: ts,
			}),
			db.insertInto("org_members").values({
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
			}),
			db.insertInto("collections").values({
				id: collectionId,
				org_id: orgId,
				name: body.collectionName,
				created_at: ts,
				updated_at: ts,
			}),
			revisionQuery(db, user.id, ts),
			auditEventInsertQuery(
				db,
				{
					actorUserId: user.id,
					action: "organization.create",
					category: "org",
					targetType: "organization",
					targetId: orgId,
					metadata: auditRequestMetadata(c.req.raw),
				},
				sql<boolean>`EXISTS (SELECT 1 FROM organizations WHERE id = ${orgId})`,
				ts,
			),
		]);
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
		const existing = await db
			.selectFrom("organizations")
			.selectAll()
			.where("id", "=", member.org_id)
			.where("deletion_requested_at", "is", null)
			.executeTakeFirst();
		if (!existing) return errorResponse("Organization not found", 404);
		const ts = Math.max(now(), existing.updated_at + 1);
		const name = c.req.valid("json").name;
		const mutationToken = crypto.randomUUID();
		const [updated] = await c.get("dbDialect").batch([
			db
				.updateTable("organizations")
				.set({ name, updated_at: ts, deletion_token: mutationToken })
				.where("id", "=", member.org_id)
				.where("deletion_requested_at", "is", null)
				.where(sql<boolean>`deletion_token IS ${existing.deletion_token}`)
				.where((eb) =>
					eb.exists(
						db
							.selectFrom("org_members as current_owner")
							.select("current_owner.id")
							.where("current_owner.id", "=", member.id)
							.where("current_owner.org_id", "=", member.org_id)
							.where("current_owner.role", "=", "owner")
							.where("current_owner.status", "=", "confirmed")
							.where(
								sql<boolean>`current_owner.mutation_token IS ${member.mutation_token}`,
							),
					),
				),
			conditionalOrganizationRevisionQuery(
				db,
				member.org_id,
				mutationToken,
				ts,
			),
		]);
		if (updated.numAffectedRows !== 1n)
			return errorResponse("Organization changed during update", 409);
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
		) {
			return errorResponse("Master password verification failed", 400);
		}
		const orgId = c.get("orgMember").org_id;
		const db = c.get("db");
		const timestamp = now();
		const deletionToken = crypto.randomUUID();
		const member = c.get("orgMember");
		const existing = await db
			.selectFrom("organizations")
			.select("deletion_token")
			.where("id", "=", orgId)
			.where("deletion_requested_at", "is", null)
			.executeTakeFirst();
		if (!existing) return new Response(null, { status: 204 });
		const ownsDeletion = db
			.selectFrom("organizations")
			.select("id")
			.where("id", "=", orgId)
			.where("deletion_token", "=", deletionToken);
		await c.get("dbDialect").batch([
			db
				.updateTable("organizations")
				.set({
					deletion_requested_at: timestamp,
					deletion_token: deletionToken,
					updated_at: timestamp,
				})
				.where("id", "=", orgId)
				.where("deletion_requested_at", "is", null)
				.where(sql<boolean>`deletion_token IS ${existing.deletion_token}`)
				.where((eb) =>
					eb.exists(
						db
							.selectFrom("org_members as current_owner")
							.select("current_owner.id")
							.where("current_owner.id", "=", member.id)
							.where("current_owner.org_id", "=", orgId)
							.where("current_owner.role", "=", "owner")
							.where("current_owner.status", "=", "confirmed")
							.where(
								sql<boolean>`current_owner.mutation_token IS ${member.mutation_token}`,
							),
					),
				),
			db
				.updateTable("ciphers")
				.set({
					deleted_at: timestamp,
					purge_after: timestamp,
					updated_at: sql<number>`MAX(updated_at + 1, ${timestamp})`,
					mutation_token: deletionToken,
				})
				.where("org_id", "=", orgId)
				.where(({ exists }) => exists(ownsDeletion)),
			db
				.updateTable("sends")
				.set({
					deletion_date: timestamp,
					updated_at: sql<number>`MAX(updated_at + 1, ${timestamp})`,
				})
				.where("org_id", "=", orgId)
				.where(({ exists }) => exists(ownsDeletion)),
			conditionalOrganizationRevisionQuery(db, orgId, deletionToken, timestamp),
			auditEventInsertQuery(
				db,
				{
					actorUserId: c.get("user").id,
					action: "organization.delete",
					category: "org",
					level: "warning",
					targetType: "organization",
					targetId: orgId,
					metadata: auditRequestMetadata(c.req.raw),
				},
				sql<boolean>`EXISTS (
					SELECT 1 FROM organizations
					WHERE id = ${orgId} AND deletion_token = ${deletionToken}
				)`,
				timestamp,
			),
		]);
		return new Response(null, { status: 204 });
	},
);

export {
	createCollection,
	deleteCollection,
	listCollections,
	listUserCollections,
	updateCollection,
} from "./organization-collections";

export {
	getInviteePublicKey,
	inviteOrganizationMember,
	listOrganizationMembers,
	removeOrganizationMember,
	updateOrganizationMember,
} from "./organization-members";
