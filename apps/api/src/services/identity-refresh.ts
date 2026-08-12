import type { D1Dialect } from "@sundoge/kysely-d1";
import { type Kysely, type Selectable, sql } from "kysely";
import { LIMITS } from "../config";
import type { DB, Users } from "../types/db";
import { createRefreshToken, hashRefreshToken } from "../utils/jwt";
import { now } from "../utils/time";
import { generateAccessToken } from "./auth";
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
	const oldTokenHash = await hashRefreshToken(args.rawToken);
	const newTokenHash = await hashRefreshToken(refreshToken);
	const [inserted] = await args.dialect.batch([
		sql`
			insert into refresh_tokens (
				token, user_id, expires_at, device_identifier, device_session_stamp
			)
			select
				${newTokenHash}, user_id,
				${sessionTime + LIMITS.auth.refreshTokenTtlSeconds},
				device_identifier, device_session_stamp
			from refresh_tokens
			where token = ${oldTokenHash}
			  and user_id = ${user.id}
		`.compile(args.db),
		args.db
			.deleteFrom("refresh_tokens")
			.where("token", "=", oldTokenHash)
			.compile(),
	]);
	if (Number(inserted.numAffectedRows ?? 0n) !== 1) {
		return { ok: false, reason: "invalid_refresh_token" };
	}
	return {
		ok: true,
		user,
		accessToken: await generateAccessToken(user, deviceSession, args.jwtSecret),
		refreshToken,
	};
}
