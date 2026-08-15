import { type CompiledQuery, type Insertable, type Kysely, sql } from "kysely";
import type { DB, WebauthnCredentials } from "../../../types/db";
import { now } from "../../../utils/time";

// Session cleanup queries are guarded by the newly written security marker to avoid revoking a newer concurrent session state.
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
