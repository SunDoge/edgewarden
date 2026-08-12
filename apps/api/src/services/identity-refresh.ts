import type { D1Dialect } from "@sundoge/kysely-d1";
import type { Kysely, Selectable } from "kysely";
import { LIMITS } from "../config";
import type { DB, Users } from "../types/db";
import { createRefreshToken, hashRefreshToken } from "../utils/jwt";
import { now } from "../utils/time";
import { generateAccessToken } from "./auth";
import { executeBatch } from "./db/batch";
import * as devicesDb from "./db/devices";
import * as refreshTokensDb from "./db/refresh-tokens";
import * as usersDb from "./db/users";
import type { LoginDeviceSession } from "./identity-session";

export type RefreshIdentitySessionFailure =
	| "invalid_refresh_token"
	| "inactive_account"
	| "invalid_device_session";

export type RefreshIdentitySessionResult =
	| {
			ok: true;
			user: Selectable<Users>;
			accessToken: string;
			refreshToken: string;
	  }
	| { ok: false; reason: RefreshIdentitySessionFailure };

export async function refreshIdentitySession(args: {
	db: Kysely<DB>;
	dialect: D1Dialect;
	rawToken: string;
	jwtSecret: string;
}): Promise<RefreshIdentitySessionResult> {
	const record = await refreshTokensDb.getRefreshTokenRecord(
		args.db,
		args.rawToken,
	);
	if (!record) return { ok: false, reason: "invalid_refresh_token" };

	const user = await usersDb.getUserById(args.db, record.userId);
	if (user?.status !== "active") {
		await refreshTokensDb.deleteRefreshToken(args.db, args.rawToken);
		return { ok: false, reason: "inactive_account" };
	}

	let deviceSession: LoginDeviceSession | null = null;
	if (record.deviceIdentifier && record.deviceSessionStamp) {
		const device = await devicesDb.getDevice(
			args.db,
			user.id,
			record.deviceIdentifier,
		);
		if (
			!device?.session_stamp ||
			device.session_stamp !== record.deviceSessionStamp
		) {
			await refreshTokensDb.deleteRefreshToken(args.db, args.rawToken);
			return { ok: false, reason: "invalid_device_session" };
		}
		deviceSession = {
			identifier: device.device_identifier,
			sessionStamp: device.session_stamp,
		};
	}

	const refreshToken = createRefreshToken();
	const sessionTime = now();
	await executeBatch(args.dialect, [
		args.db
			.deleteFrom("refresh_tokens")
			.where("token", "=", await hashRefreshToken(args.rawToken))
			.compile(),
		args.db
			.insertInto("refresh_tokens")
			.values({
				token: await hashRefreshToken(refreshToken),
				user_id: user.id,
				expires_at: sessionTime + LIMITS.auth.refreshTokenTtlSeconds,
				device_identifier: deviceSession?.identifier ?? null,
				device_session_stamp: deviceSession?.sessionStamp ?? null,
			})
			.compile(),
	]);
	return {
		ok: true,
		user,
		accessToken: await generateAccessToken(user, deviceSession, args.jwtSecret),
		refreshToken,
	};
}
