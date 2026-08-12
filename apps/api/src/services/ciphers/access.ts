import type { CompiledQuery, Kysely, Selectable } from "kysely";
import type { Ciphers, DB, OrgMembers } from "../../types/db";
import { now } from "../../utils/time";
import { revisionQuery } from "../db/batch";
import { textColumnInJson } from "../db/json-array";
import type { CipherPermissions } from "./presentation";

export async function getCipherCollectionIds(
	db: Kysely<DB>,
	cipherId: string,
): Promise<string[]> {
	return (
		await db
			.selectFrom("cipher_collections")
			.select("collection_id")
			.where("cipher_id", "=", cipherId)
			.execute()
	).map((row) => row.collection_id);
}

export async function getCipherPermissions(
	db: Kysely<DB>,
	cipher: Selectable<Ciphers>,
	member: Selectable<OrgMembers> | undefined,
	collectionIds: string[],
): Promise<CipherPermissions> {
	if (
		!cipher.org_id ||
		!member ||
		member.access_all === 1 ||
		["manager", "admin", "owner"].includes(member.role)
	) {
		return { edit: true, viewPassword: true };
	}
	const access = collectionIds.length
		? await db
				.selectFrom("collection_members")
				.select(["read_only", "hide_passwords"])
				.where("org_member_id", "=", member.id)
				.where(textColumnInJson("collection_id", collectionIds))
				.execute()
		: [];
	return {
		edit:
			access.length === collectionIds.length &&
			access.every((row) => row.read_only !== 1),
		viewPassword:
			access.length === collectionIds.length &&
			access.every((row) => row.hide_passwords !== 1),
	};
}

export async function revisionQueriesForCipher(
	db: Kysely<DB>,
	cipher: Pick<Selectable<Ciphers>, "user_id" | "org_id">,
	timestamp = now(),
): Promise<CompiledQuery[]> {
	if (cipher.user_id) return [revisionQuery(db, cipher.user_id, timestamp)];
	if (!cipher.org_id) return [];
	const members = await db
		.selectFrom("org_members")
		.select("user_id")
		.where("org_id", "=", cipher.org_id)
		.where("status", "=", "confirmed")
		.where("user_id", "is not", null)
		.execute();
	return members.map((member) =>
		revisionQuery(db, member.user_id as string, timestamp),
	);
}

export async function validateOrganizationCollections(
	db: Kysely<DB>,
	userId: string,
	organizationId: string,
	collectionIds: string[],
) {
	const uniqueIds = [...new Set(collectionIds)];
	if (!uniqueIds.length)
		return { error: "At least one collection is required" } as const;
	const member = await db
		.selectFrom("org_members")
		.selectAll()
		.where("org_id", "=", organizationId)
		.where("user_id", "=", userId)
		.where("status", "=", "confirmed")
		.executeTakeFirst();
	if (!member) return { error: "Organization not found" } as const;
	const collections = await db
		.selectFrom("collections")
		.select("id")
		.where("org_id", "=", organizationId)
		.where(textColumnInJson("id", uniqueIds))
		.execute();
	if (collections.length !== uniqueIds.length)
		return { error: "Collection not found" } as const;
	const elevated = ["manager", "admin", "owner"].includes(member.role);
	if (!elevated && !member.access_all) {
		const writable = await db
			.selectFrom("collection_members")
			.select("collection_id")
			.where("org_member_id", "=", member.id)
			.where(textColumnInJson("collection_id", uniqueIds))
			.where("read_only", "=", 0)
			.execute();
		if (writable.length !== uniqueIds.length)
			return { error: "Collection is read-only" } as const;
	}
	return { member, collectionIds: uniqueIds } as const;
}
