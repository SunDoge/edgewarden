import type { D1Dialect } from "@sundoge/kysely-d1";
import { type CompiledQuery, type Kysely, sql } from "kysely";
import type { DB } from "../../types/db";
import { now } from "../../utils/time";

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

export function organizationMemberCollectionAccessQuery(
	db: Kysely<DB>,
	memberId: string,
	collectionId: string,
	readOnly: boolean,
	hidePasswords: boolean,
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
		  AND collection.id = ${collectionId}
	`.compile(db);
}

export function webauthnCredentialRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	credentialId: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM webauthn_credentials
		WHERE id = ${credentialId}
		  AND user_id = ${userId}
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function conditionalUserRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	securityStamp: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT id, ${timestamp}
		FROM users
		WHERE id = ${userId}
		  AND security_stamp = ${securityStamp}
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function conditionalRefreshTokenDeletionQuery(
	db: Kysely<DB>,
	userId: string,
	securityStamp: string,
) {
	return sql`
		DELETE FROM refresh_tokens
		WHERE user_id = ${userId}
		  AND EXISTS (
			SELECT 1 FROM users
			WHERE id = ${userId}
			  AND security_stamp = ${securityStamp}
		  )
	`.compile(db);
}

export function conditionalTwoFactorCredentialDeletionQuery(
	db: Kysely<DB>,
	userId: string,
	securityStamp: string,
) {
	return sql`
		DELETE FROM webauthn_credentials
		WHERE user_id = ${userId}
		  AND purpose = 'twoFactor'
		  AND EXISTS (
			SELECT 1 FROM users
			WHERE id = ${userId}
			  AND security_stamp = ${securityStamp}
		  )
	`.compile(db);
}

export function attachmentCipherUpdateQuery(
	db: Kysely<DB>,
	cipherId: string,
	attachmentId: string,
	storageKey: string,
	timestamp = now(),
) {
	return sql`
		UPDATE ciphers
		SET updated_at = ${timestamp}
		WHERE id = ${cipherId}
		  AND EXISTS (
			SELECT 1 FROM attachments
			WHERE id = ${attachmentId}
			  AND cipher_id = ${cipherId}
			  AND storage_key = ${storageKey}
			  AND deleted_at IS NULL
		  )
	`.compile(db);
}

export function attachmentRevisionQuery(
	db: Kysely<DB>,
	attachmentId: string,
	storageKey: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT DISTINCT recipients.user_id, ${timestamp}
		FROM (
			SELECT cipher.user_id
			FROM attachments attachment
			INNER JOIN ciphers cipher ON cipher.id = attachment.cipher_id
			WHERE attachment.id = ${attachmentId}
			  AND attachment.storage_key = ${storageKey}
			  AND attachment.deleted_at IS NULL
			  AND cipher.user_id IS NOT NULL
			UNION
			SELECT member.user_id
			FROM attachments attachment
			INNER JOIN ciphers cipher ON cipher.id = attachment.cipher_id
			INNER JOIN org_members member ON member.org_id = cipher.org_id
			WHERE attachment.id = ${attachmentId}
			  AND attachment.storage_key = ${storageKey}
			  AND attachment.deleted_at IS NULL
			  AND member.status = 'confirmed'
			  AND member.user_id IS NOT NULL
		) recipients
		WHERE true
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function deletedAttachmentCipherUpdateQuery(
	db: Kysely<DB>,
	cipherId: string,
	attachmentId: string,
	deletionToken: string,
	timestamp = now(),
) {
	return sql`
		UPDATE ciphers
		SET updated_at = ${timestamp}
		WHERE id = ${cipherId}
		  AND EXISTS (
			SELECT 1 FROM attachments
			WHERE id = ${attachmentId}
			  AND cipher_id = ${cipherId}
			  AND deletion_token = ${deletionToken}
			  AND deleted_at IS NOT NULL
		  )
	`.compile(db);
}

export function deletedAttachmentRevisionQuery(
	db: Kysely<DB>,
	attachmentId: string,
	deletionToken: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT DISTINCT recipients.user_id, ${timestamp}
		FROM (
			SELECT cipher.user_id
			FROM attachments attachment
			INNER JOIN ciphers cipher ON cipher.id = attachment.cipher_id
			WHERE attachment.id = ${attachmentId}
			  AND attachment.deletion_token = ${deletionToken}
			  AND attachment.deleted_at IS NOT NULL
			  AND cipher.user_id IS NOT NULL
			UNION
			SELECT member.user_id
			FROM attachments attachment
			INNER JOIN ciphers cipher ON cipher.id = attachment.cipher_id
			INNER JOIN org_members member ON member.org_id = cipher.org_id
			WHERE attachment.id = ${attachmentId}
			  AND attachment.deletion_token = ${deletionToken}
			  AND attachment.deleted_at IS NOT NULL
			  AND member.status = 'confirmed'
			  AND member.user_id IS NOT NULL
		) recipients
		WHERE true
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

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

export function activeSendRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	sendIds: readonly string[],
	timestamp = now(),
) {
	return sendRevisionSelect(db, userId, sendIds, timestamp, true);
}

export async function executeBatch(
	dialect: D1Dialect,
	queries: readonly CompiledQuery[],
): Promise<void> {
	if (queries.length === 0) return;
	await dialect.batch([...queries]);
}

export async function executeBatchInChunks(
	dialect: D1Dialect,
	queries: readonly CompiledQuery[],
	chunkSize: number,
): Promise<void> {
	if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
		throw new RangeError("chunkSize must be a positive integer");
	}
	for (let index = 0; index < queries.length; index += chunkSize) {
		await executeBatch(dialect, queries.slice(index, index + chunkSize));
	}
}
