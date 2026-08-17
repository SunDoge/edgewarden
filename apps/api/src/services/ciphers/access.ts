import type { D1Dialect } from "../db/d1-dialect";
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

export async function getVisibleCipherCollectionIds(
	db: Kysely<DB>,
	cipherId: string,
	member: Selectable<OrgMembers> | undefined,
): Promise<string[]> {
	if (
		!member ||
		member.access_all === 1 ||
		["manager", "admin", "owner"].includes(member.role)
	) {
		return getCipherCollectionIds(db, cipherId);
	}
	return (
		await db
			.selectFrom("cipher_collections as link")
			.innerJoin("collection_members as access", (join) =>
				join
					.onRef("access.collection_id", "=", "link.collection_id")
					.on("access.org_member_id", "=", member.id),
			)
			.select("link.collection_id")
			.where("link.cipher_id", "=", cipherId)
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
		// Bitwarden combines duplicate collection grants using the most permissive
		// matching grant. A cipher in one writable and one read-only collection is
		// therefore writable; inaccessible collections do not weaken that grant.
		edit: access.some((row) => row.read_only !== 1),
		viewPassword: access.some((row) => row.hide_passwords !== 1),
	};
}

export async function resolveOrganizationCipherCollectionsForUpdate(
	db: Kysely<DB>,
	member: Selectable<OrgMembers>,
	organizationId: string,
	currentCollectionIds: string[],
	requestedCollectionIds: string[],
): Promise<{ collectionIds: string[] } | { error: string }> {
	const requestedIds = [...new Set(requestedCollectionIds)];
	if (!requestedIds.length)
		return { error: "At least one collection is required" };
	const requestedCollections = await db
		.selectFrom("collections")
		.select("id")
		.where("org_id", "=", organizationId)
		.where(textColumnInJson("id", requestedIds))
		.execute();
	if (requestedCollections.length !== requestedIds.length)
		return { error: "Collection not found" };
	if (
		member.access_all === 1 ||
		["manager", "admin", "owner"].includes(member.role)
	) {
		return { collectionIds: requestedIds };
	}

	const candidateIds = [...new Set([...currentCollectionIds, ...requestedIds])];
	const access = await db
		.selectFrom("collection_members")
		.select(["collection_id", "read_only"])
		.where("org_member_id", "=", member.id)
		.where(textColumnInJson("collection_id", candidateIds))
		.execute();
	const writableIds = new Set(
		access.filter((row) => row.read_only !== 1).map((row) => row.collection_id),
	);
	if (!currentCollectionIds.some((id) => writableIds.has(id)))
		return { error: "Collection is read-only" };
	const currentIds = new Set(currentCollectionIds);
	if (requestedIds.some((id) => !currentIds.has(id) && !writableIds.has(id)))
		return { error: "Collection is read-only" };

	// Only writable assignments are replaceable by this member. Preserve every
	// existing read-only or inaccessible assignment, matching the official
	// CollectionCipher_UpdateCollections behavior.
	const retainedIds = currentCollectionIds.filter((id) => !writableIds.has(id));
	const requestedWritableIds = requestedIds.filter((id) => writableIds.has(id));
	return {
		collectionIds: [...new Set([...retainedIds, ...requestedWritableIds])],
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
	buildFollowups: (mutationToken: string) => CompiledQuery[] = () => [],
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
		...buildFollowups(mutationToken),
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

/**
 * Persists the current member's view of an organization cipher only after the
 * owning cipher mutation has committed. The conditional INSERT keeps the view
 * update in the same D1 batch without opening a cross-request race window.
 */
export function organizationCipherViewStateQuery(
	db: Kysely<DB>,
	args: {
		cipherId: string;
		userId: string;
		folderId: string | null;
		favorite: number;
		archivedAt: number | null;
		updatedAt: number;
		committedMutationToken: string;
	},
) {
	return db
		.insertInto("cipher_user_settings")
		.columns([
			"cipher_id",
			"user_id",
			"folder_id",
			"favorite",
			"archived_at",
			"updated_at",
		])
		.expression(
			db
				.selectFrom("ciphers")
				.select([
					sql<string>`${args.cipherId}`.as("cipher_id"),
					sql<string>`${args.userId}`.as("user_id"),
					sql<string | null>`${args.folderId}`.as("folder_id"),
					sql<number>`${args.favorite}`.as("favorite"),
					sql<number | null>`${args.archivedAt}`.as("archived_at"),
					sql<number>`${args.updatedAt}`.as("updated_at"),
				])
				.where("id", "=", args.cipherId)
				.where("org_id", "is not", null)
				.where("mutation_token", "=", args.committedMutationToken),
		)
		.onConflict((conflict) =>
			conflict.columns(["cipher_id", "user_id"]).doUpdateSet({
				folder_id: args.folderId,
				favorite: args.favorite,
				archived_at: args.archivedAt,
				updated_at: args.updatedAt,
			}),
		)
		.compile();
}

export function visibleOrganizationCipherViewBulkUpsertQuery(
	db: Kysely<DB>,
	args: {
		userId: string;
		cipherIds: string[];
		updatedAt: number;
		folderId?: string | null;
		archivedAt?: number | null;
	},
): CompiledQuery {
	const ids = JSON.stringify([...new Set(args.cipherIds)]);
	const folder =
		args.folderId === undefined
			? sql`current_view.folder_id`
			: sql`${args.folderId}`;
	const archived =
		args.archivedAt === undefined
			? sql`current_view.archived_at`
			: sql`${args.archivedAt}`;
	const changed =
		args.folderId !== undefined && args.archivedAt !== undefined
			? sql<boolean>`current_view.folder_id IS NOT ${args.folderId}
				OR current_view.archived_at IS NOT ${args.archivedAt}`
			: args.folderId !== undefined
				? sql<boolean>`current_view.folder_id IS NOT ${args.folderId}`
				: sql<boolean>`current_view.archived_at IS NOT ${args.archivedAt ?? null}`;
	return sql`
		INSERT INTO cipher_user_settings (
			cipher_id, user_id, folder_id, favorite, archived_at, updated_at
		)
		SELECT
			cipher.id,
			${args.userId},
			${folder},
			COALESCE(current_view.favorite, 0),
			${archived},
			${args.updatedAt}
		FROM ciphers cipher
		INNER JOIN org_members member
			ON member.org_id = cipher.org_id
		 AND member.user_id = ${args.userId}
		 AND member.status = 'confirmed'
		LEFT JOIN cipher_user_settings current_view
			ON current_view.cipher_id = cipher.id
		 AND current_view.user_id = ${args.userId}
		WHERE cipher.id IN (SELECT value FROM json_each(${ids}))
		  AND cipher.deleted_at IS NULL
		  AND (${changed})
		  AND (
			member.access_all = 1
			OR EXISTS (
				SELECT 1
				FROM cipher_collections link
				INNER JOIN collection_members access
					ON access.collection_id = link.collection_id
				 AND access.org_member_id = member.id
				WHERE link.cipher_id = cipher.id
			)
		  )
		ON CONFLICT(cipher_id, user_id) DO UPDATE SET
			folder_id = excluded.folder_id,
			favorite = excluded.favorite,
			archived_at = excluded.archived_at,
			updated_at = excluded.updated_at
	`.compile(db);
}
