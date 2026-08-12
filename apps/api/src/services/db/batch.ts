import type { D1Dialect } from "@sundoge/kysely-d1";
import { type CompiledQuery, type Insertable, type Kysely, sql } from "kysely";
import type { DB, WebauthnCredentials } from "../../types/db";
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

export function conditionalWebauthnEncryptionUpdateQuery(
	db: Kysely<DB>,
	credential: {
		id: string;
		user_id: string;
		purpose: string;
		encrypted_user_key: string | null;
		encrypted_public_key: string | null;
		encrypted_private_key: string | null;
		supports_prf: number;
		mutation_token: string | null;
	},
	encryptedUserKey: string,
	encryptedPublicKey: string,
	encryptedPrivateKey: string,
	mutationToken: string,
	timestamp = now(),
) {
	return sql`
		UPDATE webauthn_credentials
		SET encrypted_user_key = ${encryptedUserKey},
		    encrypted_public_key = ${encryptedPublicKey},
		    encrypted_private_key = ${encryptedPrivateKey},
		    supports_prf = 1,
		    mutation_token = ${mutationToken},
		    updated_at = ${timestamp}
		WHERE id = ${credential.id}
		  AND user_id = ${credential.user_id}
		  AND purpose = ${credential.purpose}
		  AND encrypted_user_key IS ${credential.encrypted_user_key}
		  AND encrypted_public_key IS ${credential.encrypted_public_key}
		  AND encrypted_private_key IS ${credential.encrypted_private_key}
		  AND supports_prf = ${credential.supports_prf}
		  AND mutation_token IS ${credential.mutation_token}
	`.compile(db);
}

export function conditionalWebauthnEncryptionRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	credentialId: string,
	mutationToken: string,
	timestamp = now(),
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM webauthn_credentials
		WHERE id = ${credentialId}
		  AND user_id = ${userId}
		  AND mutation_token = ${mutationToken}
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

export function conditionalAuthenticatorUpdateQuery(
	db: Kysely<DB>,
	userId: string,
	expectedSecurityStamp: string,
	expectedSecret: string | null,
	encryptedSecret: string,
	encryptedRecoveryCode: string,
	securityStamp: string,
	timestamp = now(),
) {
	return sql`
		UPDATE users
		SET totp_secret = ${encryptedSecret},
		    totp_recovery_code = ${encryptedRecoveryCode},
		    security_stamp = ${securityStamp},
		    updated_at = ${timestamp}
		WHERE id = ${userId}
		  AND security_stamp = ${expectedSecurityStamp}
		  AND totp_secret IS ${expectedSecret}
	`.compile(db);
}

export function conditionalYubikeyUpdateQuery(
	db: Kysely<DB>,
	userId: string,
	expectedSecurityStamp: string,
	expectedConfig: string,
	yubikeyConfig: string,
	encryptedRecoveryCode: string,
	securityStamp: string,
	timestamp = now(),
) {
	return sql`
		UPDATE users
		SET yubikey_config = ${yubikeyConfig},
		    totp_recovery_code = COALESCE(
		      totp_recovery_code,
		      ${encryptedRecoveryCode}
		    ),
		    security_stamp = ${securityStamp},
		    updated_at = ${timestamp}
		WHERE id = ${userId}
		  AND security_stamp = ${expectedSecurityStamp}
		  AND yubikey_config = ${expectedConfig}
	`.compile(db);
}

export function conditionalTwoFactorPasskeyClaimQuery(
	db: Kysely<DB>,
	userId: string,
	expectedSecurityStamp: string,
	credentialId: string,
	encryptedRecoveryCode: string,
	securityStamp: string,
	maximumCredentials: number,
	timestamp = now(),
	challenge?: { hash: string; scope: string },
) {
	return sql`
		UPDATE users
		SET totp_recovery_code = COALESCE(
		      totp_recovery_code,
		      ${encryptedRecoveryCode}
		    ),
		    security_stamp = ${securityStamp},
		    updated_at = ${timestamp}
		WHERE id = ${userId}
		  AND security_stamp = ${expectedSecurityStamp}
		  AND NOT EXISTS (
		    SELECT 1 FROM webauthn_credentials
		    WHERE credential_id = ${credentialId}
		  )
		  AND (
		    SELECT COUNT(*) FROM webauthn_credentials
		    WHERE user_id = ${userId} AND purpose = 'twoFactor'
		  ) < ${maximumCredentials}
		  AND ${
				challenge
					? sql<boolean>`EXISTS (
		    SELECT 1 FROM webauthn_challenges
		    WHERE challenge_hash = ${challenge.hash}
		      AND scope = ${challenge.scope}
		      AND user_id = ${userId}
		      AND used_at IS NULL
		      AND expires_at > ${timestamp}
		  )`
					: sql<boolean>`TRUE`
			}
	`.compile(db);
}

export function conditionalWebauthnCredentialInsertQuery(
	db: Kysely<DB>,
	credential: Insertable<WebauthnCredentials>,
	securityStamp: string,
) {
	return sql`
		INSERT INTO webauthn_credentials (
		  id, user_id, purpose, name, public_key, credential_id, counter,
		  type, aa_guid, transports, encrypted_user_key, encrypted_public_key,
		  encrypted_private_key, supports_prf, mutation_token, created_at, updated_at
		)
		SELECT
		  ${credential.id}, ${credential.user_id}, ${credential.purpose},
		  ${credential.name}, ${credential.public_key}, ${credential.credential_id},
		  ${credential.counter}, ${credential.type}, ${credential.aa_guid},
		  ${credential.transports}, ${credential.encrypted_user_key},
		  ${credential.encrypted_public_key}, ${credential.encrypted_private_key},
		  ${credential.supports_prf}, ${credential.mutation_token},
		  ${credential.created_at},
		  ${credential.updated_at}
		FROM users
		WHERE id = ${credential.user_id}
		  AND security_stamp = ${securityStamp}
	`.compile(db);
}

export function conditionalAccountPasskeyClaimQuery(
	db: Kysely<DB>,
	userId: string,
	expectedSecurityStamp: string,
	credentialId: string,
	securityStamp: string,
	maximumCredentials: number,
	timestamp = now(),
	challenge?: { hash: string; scope: string },
) {
	return sql`
		UPDATE users
		SET security_stamp = ${securityStamp}, updated_at = ${timestamp}
		WHERE id = ${userId}
		  AND security_stamp = ${expectedSecurityStamp}
		  AND NOT EXISTS (
		    SELECT 1 FROM webauthn_credentials
		    WHERE credential_id = ${credentialId}
		  )
		  AND (
		    SELECT COUNT(*) FROM webauthn_credentials
		    WHERE user_id = ${userId} AND purpose = 'login'
		  ) < ${maximumCredentials}
		  AND ${
				challenge
					? sql<boolean>`EXISTS (
		    SELECT 1 FROM webauthn_challenges
		    WHERE challenge_hash = ${challenge.hash}
		      AND scope = ${challenge.scope}
		      AND user_id = ${userId}
		      AND used_at IS NULL
		      AND expires_at > ${timestamp}
		  )`
					: sql<boolean>`TRUE`
			}
	`.compile(db);
}

export function conditionalWebauthnChallengeConsumptionQuery(
	db: Kysely<DB>,
	args: {
		challengeHash: string;
		scope: string;
		userId: string;
		credentialId: string;
		mutationToken: string;
		timestamp: number;
	},
) {
	return sql`
		UPDATE webauthn_challenges
		SET used_at = ${args.timestamp}
		WHERE challenge_hash = ${args.challengeHash}
		  AND scope = ${args.scope}
		  AND user_id = ${args.userId}
		  AND used_at IS NULL
		  AND expires_at > ${args.timestamp}
		  AND EXISTS (
		    SELECT 1 FROM webauthn_credentials
		    WHERE credential_id = ${args.credentialId}
		      AND mutation_token = ${args.mutationToken}
		  )
	`.compile(db);
}

export function conditionalWebauthnCredentialDeletionClaimQuery(
	db: Kysely<DB>,
	userId: string,
	credentialId: string,
	purpose: string,
	expectedSecurityStamp: string,
	securityStamp: string,
	timestamp = now(),
) {
	return sql`
		UPDATE users
		SET security_stamp = ${securityStamp}, updated_at = ${timestamp}
		WHERE id = ${userId}
		  AND security_stamp = ${expectedSecurityStamp}
		  AND EXISTS (
		    SELECT 1 FROM webauthn_credentials
		    WHERE id = ${credentialId}
		      AND user_id = ${userId}
		      AND purpose = ${purpose}
		  )
	`.compile(db);
}

export function conditionalWebauthnCredentialDeletionQuery(
	db: Kysely<DB>,
	userId: string,
	credentialId: string,
	purpose: string,
	securityStamp: string,
) {
	return sql`
		DELETE FROM webauthn_credentials
		WHERE id = ${credentialId}
		  AND user_id = ${userId}
		  AND purpose = ${purpose}
		  AND EXISTS (
		    SELECT 1 FROM users
		    WHERE id = ${userId} AND security_stamp = ${securityStamp}
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

export function conditionalAllDevicesDeletionClaimQuery(
	db: Kysely<DB>,
	userId: string,
	expectedSecurityStamp: string,
	securityStamp: string,
	timestamp = now(),
) {
	return sql`
		UPDATE users
		SET security_stamp = ${securityStamp}, updated_at = ${timestamp}
		WHERE id = ${userId}
		  AND security_stamp = ${expectedSecurityStamp}
		  AND deletion_requested_at IS NULL
	`.compile(db);
}

export function conditionalDeviceTrustTokenDeletionQuery(
	db: Kysely<DB>,
	userId: string,
	securityStamp: string,
) {
	return sql`
		DELETE FROM device_trust_tokens
		WHERE user_id = ${userId}
		  AND EXISTS (
		    SELECT 1 FROM users
		    WHERE id = ${userId} AND security_stamp = ${securityStamp}
		  )
	`.compile(db);
}

export function conditionalAllDevicesDeletionQuery(
	db: Kysely<DB>,
	userId: string,
	securityStamp: string,
) {
	return sql`
		DELETE FROM devices
		WHERE user_id = ${userId}
		  AND EXISTS (
		    SELECT 1 FROM users
		    WHERE id = ${userId} AND security_stamp = ${securityStamp}
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
