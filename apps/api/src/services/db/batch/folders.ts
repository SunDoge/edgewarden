import { type CompiledQuery, type Insertable, type Kysely, sql } from "kysely";
import type { DB, WebauthnCredentials } from "../../../types/db";
import { now } from "../../../utils/time";

// Folder changes advance the owning user's revision in the same batch as the mutation.
export function folderRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	folderIds: readonly string[],
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM folders
		WHERE user_id = ${userId}
		  AND id IN (SELECT value FROM json_each(${JSON.stringify(folderIds)}))
		GROUP BY user_id
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function conditionalFolderRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	mutationToken: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT ${userId}, ${timestamp}
		WHERE EXISTS (
			SELECT 1 FROM folders
			WHERE user_id = ${userId}
			  AND mutation_token = ${mutationToken}
		)
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}
