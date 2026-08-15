import { type CompiledQuery, type Insertable, type Kysely, sql } from "kysely";
import type { DB, WebauthnCredentials } from "../../../types/db";
import { now } from "../../../utils/time";

// Attachment metadata and cipher revisions must be committed together so clients never observe a stale attachment list.
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
