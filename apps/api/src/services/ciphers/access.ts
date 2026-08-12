import type { D1Dialect } from "@sundoge/kysely-d1";
import {
	type CompiledQuery,
	type Kysely,
	type RawBuilder,
	type Selectable,
	sql,
} from "kysely";
import type { Ciphers, DB, OrgMembers } from "../../types/db";
import { now } from "../../utils/time";
import { organizationRevisionQuery, revisionQuery } from "../db/batch";
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
	return [organizationRevisionQuery(db, cipher.org_id, timestamp)];
}

export function conditionalCipherRevisionQuery(
	db: Kysely<DB>,
	cipherId: string,
	mutationToken: string,
	timestamp = now(),
): CompiledQuery {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp} FROM ciphers
		WHERE id = ${cipherId} AND mutation_token = ${mutationToken}
		  AND user_id IS NOT NULL
		UNION
		SELECT member.user_id, ${timestamp}
		FROM ciphers cipher
		INNER JOIN org_members member ON member.org_id = cipher.org_id
		WHERE cipher.id = ${cipherId}
		  AND cipher.mutation_token = ${mutationToken}
		  AND member.status = 'confirmed'
		  AND member.user_id IS NOT NULL
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function conditionalPersonalCipherBulkRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	mutationToken: string,
	timestamp = now(),
): CompiledQuery {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT ${userId}, ${timestamp}
		WHERE EXISTS (
			SELECT 1 FROM ciphers
			WHERE user_id = ${userId}
			  AND mutation_token = ${mutationToken}
		)
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

interface CipherMutationFenceCandidate {
	id: string;
	mutation_token: string | null;
}

export async function executeFencedPersonalCipherBulkMutation(
	dialect: D1Dialect,
	db: Kysely<DB>,
	userId: string,
	candidates: readonly CipherMutationFenceCandidate[],
	timestamp: number,
	buildUpdate: (
		mutationToken: string,
		expectedState: RawBuilder<boolean>,
	) => CompiledQuery,
): Promise<number> {
	if (!candidates.length) return 0;
	const mutationToken = crypto.randomUUID();
	const serializedState = JSON.stringify(candidates);
	const expectedState = sql<boolean>`EXISTS (
		SELECT 1 FROM json_each(${serializedState}) expected
		WHERE json_extract(expected.value, '$.id') = ciphers.id
		  AND ciphers.mutation_token IS json_extract(expected.value, '$.mutation_token')
	)`;
	const [mutated] = await dialect.batch([
		buildUpdate(mutationToken, expectedState),
		conditionalPersonalCipherBulkRevisionQuery(
			db,
			userId,
			mutationToken,
			timestamp,
		),
	]);
	return Number(mutated.numAffectedRows);
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
