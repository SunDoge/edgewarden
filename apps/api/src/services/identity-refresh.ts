import type { D1Dialect } from "./db/d1-dialect";
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

export function refreshTokenRotationInsertQuery(
  db: Kysely<DB>,
  args: {
    oldTokenHash: string;
    newTokenHash: string;
    userId: string;
    expectedSecurityStamp: string;
    sessionTime: number;
  },
) {
  return sql`
		INSERT INTO refresh_tokens (
			token, user_id, expires_at, device_identifier, device_session_stamp
		)
		SELECT
			${args.newTokenHash}, current_token.user_id,
			${args.sessionTime + LIMITS.auth.refreshTokenTtlSeconds},
			current_token.device_identifier,
			current_token.device_session_stamp
		FROM refresh_tokens current_token
		INNER JOIN users current_user ON current_user.id = current_token.user_id
		WHERE current_token.token = ${args.oldTokenHash}
		  AND current_token.user_id = ${args.userId}
		  AND current_token.expires_at > ${args.sessionTime}
		  AND current_user.status = 'active'
		  AND current_user.deletion_requested_at IS NULL
		  AND current_user.security_stamp = ${args.expectedSecurityStamp}
		  AND (
		    (
		      current_token.device_identifier IS NULL
		      AND current_token.device_session_stamp IS NULL
		    )
		    OR EXISTS (
		      SELECT 1 FROM devices current_device
		      WHERE current_device.user_id = current_token.user_id
		        AND current_device.device_identifier = current_token.device_identifier
		        AND current_device.session_stamp = current_token.device_session_stamp
		        AND current_device.banned = 0
		    )
		  )
	`.compile(db);
}

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
  if (
    (record.deviceIdentifier === null) !==
    (record.deviceSessionStamp === null)
  ) {
    await refreshTokensDb.deleteRefreshToken(args.db, args.rawToken);
    return { ok: false, reason: "invalid_device_session" };
  }
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
    refreshTokenRotationInsertQuery(args.db, {
      oldTokenHash,
      newTokenHash,
      userId: user.id,
      expectedSecurityStamp: user.security_stamp,
      sessionTime,
    }),
    args.db.deleteFrom("refresh_tokens").where("token", "=", oldTokenHash),
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
