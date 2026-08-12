import type { D1Dialect } from "@sundoge/kysely-d1";
import { type Kysely, type Selectable, sql } from "kysely";
import { LIMITS } from "../config";
import type { DB, Users } from "../types/db";
import { createRefreshToken, hashRefreshToken } from "../utils/jwt";
import { now } from "../utils/time";
import { generateAccessToken } from "./auth";
import { executeBatch, revisionQuery } from "./db/batch";
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

async function registerLoginDevice(
	db: Kysely<DB>,
	userId: string,
	device: LoginDeviceInfo,
): Promise<LoginDeviceSession | null> {
	if (!device.identifier) return null;
	const sessionStamp = crypto.randomUUID();
	await devicesDb.upsertDevice(
		db,
		userId,
		device.identifier,
		device.name,
		device.type,
		sessionStamp,
	);
	const stored = await devicesDb.getDevice(db, userId, device.identifier);
	if (!stored?.session_stamp) throw new Error("Login device was not persisted");
	return { identifier: device.identifier, sessionStamp: stored.session_stamp };
}

export async function issueIdentitySession(args: {
	db: Kysely<DB>;
	dialect: D1Dialect;
	user: Selectable<Users>;
	device: LoginDeviceInfo;
	jwtSecret: string;
	authRequest?: AuthRequestConsumption | null;
}): Promise<IssuedIdentitySession | null> {
	const deviceSession = await registerLoginDevice(
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
		const [consumed, inserted] = await args.dialect.batch([
			args.db
				.updateTable("auth_requests")
				.set({
					authentication_date: sessionTime,
					consumption_token: consumption.token,
				})
				.where("id", "=", consumption.id)
				.where("user_id", "=", args.user.id)
				.where("approved", "=", 1)
				.where("authentication_date", "is", null)
				.where("consumption_token", "is", null)
				.compile(),
			sql`
				INSERT INTO refresh_tokens (
					token, user_id, expires_at,
					device_identifier, device_session_stamp
				)
				SELECT
					${refreshTokenHash}, ${args.user.id},
					${sessionTime + LIMITS.auth.refreshTokenTtlSeconds},
					${deviceSession?.identifier ?? null},
					${deviceSession?.sessionStamp ?? null}
				FROM auth_requests
				WHERE id = ${consumption.id}
				  AND user_id = ${args.user.id}
				  AND consumption_token = ${consumption.token}
			`.compile(args.db),
			sql`
				INSERT INTO user_revisions (user_id, revision_date)
				SELECT ${args.user.id}, ${sessionTime}
				FROM auth_requests
				WHERE id = ${consumption.id}
				  AND user_id = ${args.user.id}
				  AND consumption_token = ${consumption.token}
				ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
					user_revisions.revision_date + 1,
					excluded.revision_date
				)
			`.compile(args.db),
		]);
		if (consumed.numAffectedRows !== 1n || inserted.numAffectedRows !== 1n)
			return null;
	} else {
		await executeBatch(args.dialect, [
			args.db
				.insertInto("refresh_tokens")
				.values({
					token: refreshTokenHash,
					user_id: args.user.id,
					expires_at: sessionTime + LIMITS.auth.refreshTokenTtlSeconds,
					device_identifier: deviceSession?.identifier ?? null,
					device_session_stamp: deviceSession?.sessionStamp ?? null,
				})
				.compile(),
			revisionQuery(args.db, args.user.id, sessionTime),
		]);
	}
	return { accessToken, refreshToken, deviceSession };
}
