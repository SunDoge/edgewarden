import type { D1Dialect } from "@sundoge/kysely-d1";
import type { Kysely, Selectable } from "kysely";
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

async function registerLoginDevice(
	db: Kysely<DB>,
	userId: string,
	device: LoginDeviceInfo,
): Promise<LoginDeviceSession | null> {
	if (!device.identifier) return null;
	const existing = await devicesDb.getDevice(db, userId, device.identifier);
	const sessionStamp = existing?.session_stamp ?? crypto.randomUUID();
	await devicesDb.upsertDevice(
		db,
		userId,
		device.identifier,
		device.name,
		device.type,
		sessionStamp,
	);
	return { identifier: device.identifier, sessionStamp };
}

export async function issueIdentitySession(args: {
	db: Kysely<DB>;
	dialect: D1Dialect;
	user: Selectable<Users>;
	device: LoginDeviceInfo;
	jwtSecret: string;
}): Promise<IssuedIdentitySession> {
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
	await executeBatch(args.dialect, [
		args.db
			.insertInto("refresh_tokens")
			.values({
				token: await hashRefreshToken(refreshToken),
				user_id: args.user.id,
				expires_at: sessionTime + LIMITS.auth.refreshTokenTtlSeconds,
				device_identifier: deviceSession?.identifier ?? null,
				device_session_stamp: deviceSession?.sessionStamp ?? null,
			})
			.compile(),
		revisionQuery(args.db, args.user.id, sessionTime),
	]);
	return { accessToken, refreshToken, deviceSession };
}
