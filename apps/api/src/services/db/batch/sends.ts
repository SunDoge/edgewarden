import { type CompiledQuery, type Insertable, type Kysely, sql } from "kysely";
import type { DB, WebauthnCredentials } from "../../../types/db";
import { now } from "../../../utils/time";

// Send revision queries cover both claimed and anonymous Sends without exposing ownership checks to handlers.
function sendRevisionSelect(
	db: Kysely<DB>,
	userId: string,
	sendIds: readonly string[],
	timestamp: number,
	activeOnly: boolean,
) {
	const activePredicate = activeOnly
		? sql`AND deletion_date > ${timestamp}`
		: sql``;
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM sends
		WHERE user_id = ${userId}
		  AND id IN (SELECT value FROM json_each(${JSON.stringify(sendIds)}))
		  ${activePredicate}
		GROUP BY user_id
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function sendRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	sendIds: readonly string[],
	timestamp = now(),
) {
	return sendRevisionSelect(db, userId, sendIds, timestamp, false);
}

export function unclaimedSendRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	sendIds: readonly string[],
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM sends
		WHERE user_id = ${userId}
		  AND id IN (SELECT value FROM json_each(${JSON.stringify(sendIds)}))
		  AND purge_token IS NULL
		GROUP BY user_id
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function activeSendRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	sendIds: readonly string[],
	timestamp = now(),
) {
	return sendRevisionSelect(db, userId, sendIds, timestamp, true);
}
