import type { D1Dialect } from "@sundoge/kysely-d1";
import { type Kysely, type Selectable, sql } from "kysely";
import { LIMITS } from "../config";
import type { DB, Users } from "../types/db";
import { createRefreshToken, hashRefreshToken } from "../utils/jwt";
import { now } from "../utils/time";
import { generateAccessToken } from "./auth";
import * as devicesDb from "./db/devices";

export interface LoginDeviceInfo {
	identifier: string;
	name: string;
	type: number;
}

export interface LoginDeviceSession {
	identifier: string;
	sessionStamp: string;
}

export interface IssuedIdentitySession {
	accessToken: string;
	refreshToken: string;
	deviceSession: LoginDeviceSession | null;
}

export interface AuthRequestConsumption {
	id: string;
	token: string;
}

function sessionEligibility(
	userId: string,
	expectedSecurityStamp: string,
	deviceSession: LoginDeviceSession | null,
) {
	return sql<boolean>`
		${userEligibility(userId, expectedSecurityStamp)}
		AND (
		  (
		    ${deviceSession?.identifier ?? null} IS NULL
		    AND ${deviceSession?.sessionStamp ?? null} IS NULL
		  )
		  OR EXISTS (
		    SELECT 1 FROM devices current_device
		    WHERE current_device.user_id = current_user.id
		      AND current_device.device_identifier = ${deviceSession?.identifier ?? null}
		      AND current_device.session_stamp = ${deviceSession?.sessionStamp ?? null}
		      AND current_device.banned = 0
		  )
		)
	`;
}

function userEligibility(userId: string, expectedSecurityStamp: string) {
	return sql<boolean>`
		current_user.id = ${userId}
		AND current_user.status = 'active'
		AND current_user.deletion_requested_at IS NULL
		AND current_user.security_stamp = ${expectedSecurityStamp}
	`;
}

export function loginDeviceUpsertQuery(
	db: Kysely<DB>,
	args: {
		userId: string;
		expectedSecurityStamp: string;
		device: LoginDeviceInfo;
		deviceSession: LoginDeviceSession;
		sessionTime: number;
		authRequest?: AuthRequestConsumption | null;
	},
) {
	return sql`
		INSERT INTO devices (
			user_id, device_identifier, name, type, session_stamp,
			created_at, updated_at
		)
		SELECT
			current_user.id, ${args.device.identifier}, ${args.device.name},
			${args.device.type}, ${args.deviceSession.sessionStamp},
			${args.sessionTime}, ${args.sessionTime}
		FROM users current_user
		WHERE ${userEligibility(args.userId, args.expectedSecurityStamp)}
		  AND ${
				args.authRequest
					? sql<boolean>`EXISTS (
						SELECT 1 FROM auth_requests request
						WHERE request.id = ${args.authRequest.id}
						  AND request.user_id = ${args.userId}
						  AND request.consumption_token = ${args.authRequest.token}
					)`
					: sql<boolean>`TRUE`
			}
		ON CONFLICT(user_id, device_identifier) DO UPDATE SET
			name = excluded.name,
			type = excluded.type,
			session_stamp = COALESCE(devices.session_stamp, excluded.session_stamp),
			last_seen_at = excluded.updated_at,
			updated_at = excluded.updated_at
	`.compile(db);
}

export function identitySessionInsertQuery(
	db: Kysely<DB>,
	args: {
		refreshTokenHash: string;
		userId: string;
		expectedSecurityStamp: string;
		deviceSession: LoginDeviceSession | null;
		sessionTime: number;
		authRequest?: AuthRequestConsumption | null;
	},
) {
	return sql`
		INSERT INTO refresh_tokens (
			token, user_id, expires_at, device_identifier, device_session_stamp
		)
		SELECT
			${args.refreshTokenHash}, current_user.id,
			${args.sessionTime + LIMITS.auth.refreshTokenTtlSeconds},
			${args.deviceSession?.identifier ?? null},
			${args.deviceSession?.sessionStamp ?? null}
		FROM users current_user
		WHERE ${sessionEligibility(
			args.userId,
			args.expectedSecurityStamp,
			args.deviceSession,
		)}
		  AND ${
				args.authRequest
					? sql<boolean>`EXISTS (
						SELECT 1 FROM auth_requests request
						WHERE request.id = ${args.authRequest.id}
						  AND request.user_id = ${args.userId}
						  AND request.consumption_token = ${args.authRequest.token}
					)`
					: sql<boolean>`TRUE`
			}
	`.compile(db);
}

export function refreshTokenRevisionQuery(
	db: Kysely<DB>,
	userId: string,
	refreshTokenHash: string,
	timestamp: number,
) {
	return sql`
		INSERT INTO user_revisions (user_id, revision_date)
		SELECT user_id, ${timestamp}
		FROM refresh_tokens
		WHERE token = ${refreshTokenHash} AND user_id = ${userId}
		ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
			user_revisions.revision_date + 1,
			excluded.revision_date
		)
	`.compile(db);
}

export function authRequestConsumptionClaimQuery(
	db: Kysely<DB>,
	args: {
		request: AuthRequestConsumption;
		userId: string;
		expectedSecurityStamp: string;
		deviceSession: LoginDeviceSession | null;
		timestamp: number;
	},
) {
	return sql`
		UPDATE auth_requests
		SET authentication_date = ${args.timestamp},
		    consumption_token = ${args.request.token}
		WHERE id = ${args.request.id}
		  AND user_id = ${args.userId}
		  AND approved = 1
		  AND authentication_date IS NULL
		  AND consumption_token IS NULL
		  AND EXISTS (
		    SELECT 1 FROM users current_user
		    WHERE ${sessionEligibility(
					args.userId,
					args.expectedSecurityStamp,
					args.deviceSession,
				)}
		  )
	`.compile(db);
}

async function prepareLoginDevice(
	db: Kysely<DB>,
	userId: string,
	device: LoginDeviceInfo,
): Promise<LoginDeviceSession | null> {
	if (!device.identifier) return null;
	const stored = await devicesDb.getDevice(db, userId, device.identifier);
	return {
		identifier: device.identifier,
		sessionStamp: stored?.session_stamp ?? crypto.randomUUID(),
	};
}

export async function issueIdentitySession(
	args: {
		db: Kysely<DB>;
		dialect: D1Dialect;
		user: Selectable<Users>;
		device: LoginDeviceInfo;
		jwtSecret: string;
		authRequest?: AuthRequestConsumption | null;
	},
	deviceConflictRetries = 1,
): Promise<IssuedIdentitySession | null> {
	const deviceSession = await prepareLoginDevice(
		args.db,
		args.user.id,
		args.device,
	);
	const accessToken = await generateAccessToken(
		args.user,
		deviceSession,
		args.jwtSecret,
	);
	const refreshToken = createRefreshToken();
	const sessionTime = now();
	const refreshTokenHash = await hashRefreshToken(refreshToken);
	if (args.authRequest) {
		const consumption = args.authRequest;
		const queries = [
			authRequestConsumptionClaimQuery(args.db, {
				request: consumption,
				userId: args.user.id,
				expectedSecurityStamp: args.user.security_stamp,
				deviceSession,
				timestamp: sessionTime,
			}),
			...(deviceSession
				? [
						loginDeviceUpsertQuery(args.db, {
							userId: args.user.id,
							expectedSecurityStamp: args.user.security_stamp,
							device: args.device,
							deviceSession,
							sessionTime,
							authRequest: consumption,
						}),
					]
				: []),
			identitySessionInsertQuery(args.db, {
				refreshTokenHash,
				userId: args.user.id,
				expectedSecurityStamp: args.user.security_stamp,
				deviceSession,
				sessionTime,
				authRequest: consumption,
			}),
			refreshTokenRevisionQuery(
				args.db,
				args.user.id,
				refreshTokenHash,
				sessionTime,
			),
		];
		const results = await args.dialect.batch(queries);
		const consumed = results[0];
		const inserted = results[deviceSession ? 2 : 1];
		if (consumed.numAffectedRows !== 1n || inserted.numAffectedRows !== 1n)
			return retryAfterDeviceConflict(
				args,
				deviceSession,
				deviceConflictRetries,
			);
	} else {
		const queries = [
			...(deviceSession
				? [
						loginDeviceUpsertQuery(args.db, {
							userId: args.user.id,
							expectedSecurityStamp: args.user.security_stamp,
							device: args.device,
							deviceSession,
							sessionTime,
						}),
					]
				: []),
			identitySessionInsertQuery(args.db, {
				refreshTokenHash,
				userId: args.user.id,
				expectedSecurityStamp: args.user.security_stamp,
				deviceSession,
				sessionTime,
			}),
			refreshTokenRevisionQuery(
				args.db,
				args.user.id,
				refreshTokenHash,
				sessionTime,
			),
		];
		const results = await args.dialect.batch(queries);
		const inserted = results[deviceSession ? 1 : 0];
		if (inserted.numAffectedRows !== 1n)
			return retryAfterDeviceConflict(
				args,
				deviceSession,
				deviceConflictRetries,
			);
	}
	return { accessToken, refreshToken, deviceSession };
}

async function retryAfterDeviceConflict(
	args: Parameters<typeof issueIdentitySession>[0],
	expectedDevice: LoginDeviceSession | null,
	retriesRemaining: number,
): Promise<IssuedIdentitySession | null> {
	if (!expectedDevice || retriesRemaining < 1) return null;
	const stored = await devicesDb.getDevice(
		args.db,
		args.user.id,
		expectedDevice.identifier,
	);
	if (
		!stored?.session_stamp ||
		stored.session_stamp === expectedDevice.sessionStamp
	)
		return null;
	return issueIdentitySession(args, retriesRemaining - 1);
}
