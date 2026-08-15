import { type CompiledQuery, type Insertable, type Kysely, sql } from "kysely";
import type { DB, WebauthnCredentials } from "../../../types/db";
import { now } from "../../../utils/time";

// Revision writes deliberately use monotonic MAX updates so concurrent mutations cannot move a user's sync cursor backwards.
export function revisionQuery(
	db: Kysely<DB>,
	userId: string,
	timestamp = now(),
) {
	return db
		.insertInto("user_revisions")
		.values({ user_id: userId, revision_date: timestamp })
		.onConflict((oc) =>
			oc.column("user_id").doUpdateSet({
				revision_date: sql<number>`MAX(user_revisions.revision_date + 1, excluded.revision_date)`,
			}),
		)
		.compile();
}

export function organizationRevisionQuery(
	db: Kysely<DB>,
	organizationId: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT DISTINCT user_id, ${timestamp}
		FROM org_members
		WHERE org_id = ${organizationId}
		  AND status = 'confirmed'
		  AND user_id IS NOT NULL
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function conditionalOrganizationRevisionQuery(
	db: Kysely<DB>,
	organizationId: string,
	deletionToken: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT DISTINCT member.user_id, ${timestamp}
		FROM org_members member
		INNER JOIN organizations org ON org.id = member.org_id
		WHERE org.id = ${organizationId}
		  AND org.deletion_token = ${deletionToken}
		  AND member.status = 'confirmed'
		  AND member.user_id IS NOT NULL
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function collectionRevisionQuery(
	db: Kysely<DB>,
	collectionId: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT DISTINCT member.user_id, ${timestamp}
		FROM collections collection
		INNER JOIN org_members member ON member.org_id = collection.org_id
		WHERE collection.id = ${collectionId}
		  AND member.status = 'confirmed'
		  AND member.user_id IS NOT NULL
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function conditionalCollectionRevisionQuery(
	db: Kysely<DB>,
	collectionId: string,
	mutationToken: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT DISTINCT member.user_id, ${timestamp}
		FROM collections collection
		INNER JOIN org_members member ON member.org_id = collection.org_id
		WHERE collection.id = ${collectionId}
		  AND collection.mutation_token = ${mutationToken}
		  AND member.status = 'confirmed'
		  AND member.user_id IS NOT NULL
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function organizationMemberRevisionQuery(
	db: Kysely<DB>,
	memberId: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM org_members
		WHERE id = ${memberId}
		  AND user_id IS NOT NULL
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function conditionalOrganizationMemberRevisionQuery(
	db: Kysely<DB>,
	memberId: string,
	mutationToken: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM org_members
		WHERE id = ${memberId}
		  AND mutation_token = ${mutationToken}
		  AND user_id IS NOT NULL
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function organizationMemberInvitationRevisionQuery(
	db: Kysely<DB>,
	memberId: string,
	actorUserId: string,
	mutationToken: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM org_members
		WHERE id = ${memberId}
		  AND mutation_token = ${mutationToken}
		  AND user_id IS NOT NULL
		UNION
		SELECT ${actorUserId}, ${timestamp}
		WHERE EXISTS (
			SELECT 1 FROM org_members
			WHERE id = ${memberId}
			  AND mutation_token = ${mutationToken}
		)
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function organizationMemberCollectionAccessQuery(
	db: Kysely<DB>,
	memberId: string,
	collectionId: string,
	readOnly: boolean,
	hidePasswords: boolean,
	mutationToken?: string,
) {
	return sql`
		INSERT INTO collection_members (
			collection_id,
			org_member_id,
			read_only,
			hide_passwords
		)
		SELECT
			collection.id,
			member.id,
			${readOnly ? 1 : 0},
			${hidePasswords ? 1 : 0}
		FROM org_members member
		INNER JOIN collections collection ON collection.org_id = member.org_id
		WHERE member.id = ${memberId}
		  AND ${
				mutationToken === undefined
					? sql<boolean>`true`
					: sql<boolean>`member.mutation_token = ${mutationToken}`
			}
		  AND collection.id = ${collectionId}
	`.compile(db);
}
