import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
	CreateOrganizationSchema,
	DeleteOrganizationSchema,
	UpdateOrganizationSchema,
} from "../schemas/organizations";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { verifyPassword } from "../services/auth";
import { executeBatch, revisionQuery } from "../services/db/batch";
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
		if (!user.public_key || !user.private_key) {
			return errorResponse("Account encryption keys are required", 409);
		}
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
		) {
			return errorResponse("Master password verification failed", 400);
		}
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
