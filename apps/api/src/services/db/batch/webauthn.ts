import { type CompiledQuery, type Insertable, type Kysely, sql } from "kysely";
import type { DB, WebauthnCredentials } from "../../../types/db";
import { now } from "../../../utils/time";

// Conditional WebAuthn statements couple a credential claim with its revision update inside the same D1 batch.
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
