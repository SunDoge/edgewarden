import { type Kysely, type Selectable, sql } from "kysely";
import type { DB, AuthRequests } from "../../types/db";
import { now } from "../../utils/time";

// Auth requests expire after 15 minutes
const AUTH_REQUEST_TTL_SECONDS = 15 * 60;

export function isAuthRequestExpired(req: Selectable<AuthRequests>): boolean {
  return req.creation_date + AUTH_REQUEST_TTL_SECONDS < now();
}

export async function createAuthRequest(
  db: Kysely<DB>,
  data: {
    id: string;
    userId: string;
    type: number;
    requestDeviceIdentifier: string;
    requestDeviceType: number;
    requestIpAddress: string | null;
    accessCodeHash: string;
    publicKey: string;
  },
): Promise<void> {
  await db
    .insertInto("auth_requests")
    .values({
      id: data.id,
      user_id: data.userId,
      type: data.type,
      request_device_identifier: data.requestDeviceIdentifier,
      request_device_type: data.requestDeviceType,
      request_ip_address: data.requestIpAddress,
      access_code_hash: data.accessCodeHash,
      public_key: data.publicKey,
      creation_date: now(),
    })
    .execute();
}

export async function getAuthRequestById(
  db: Kysely<DB>,
  id: string,
): Promise<Selectable<AuthRequests> | null> {
  return (
    (await db
      .selectFrom("auth_requests")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()) ?? null
  );
}

export async function getPendingAuthRequestsForDevice(
  db: Kysely<DB>,
  userId: string,
  deviceIdentifier: string,
): Promise<Selectable<AuthRequests>[]> {
  const cutoff = now() - AUTH_REQUEST_TTL_SECONDS;
  return db
    .selectFrom("auth_requests")
    .selectAll()
    .where("user_id", "=", userId)
    .where("request_device_identifier", "=", deviceIdentifier)
    .where("approved", "is", null)
    .where("creation_date", ">", cutoff)
    .orderBy("creation_date", "desc")
    .execute();
}

export async function getAuthRequestsByUserId(
  db: Kysely<DB>,
  userId: string,
): Promise<Selectable<AuthRequests>[]> {
  return db
    .selectFrom("auth_requests")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("creation_date", "desc")
    .execute();
}

export async function getPendingAuthRequestsByUserId(
  db: Kysely<DB>,
  userId: string,
): Promise<Selectable<AuthRequests>[]> {
  const cutoff = now() - AUTH_REQUEST_TTL_SECONDS;
  return db
    .selectFrom("auth_requests as request")
    .selectAll("request")
    .where("request.user_id", "=", userId)
    .where("request.approved", "is", null)
    .where("request.response_date", "is", null)
    .where("request.creation_date", ">", cutoff)
    .where(sql<boolean>`NOT EXISTS (
      SELECT 1 FROM auth_requests newer
      WHERE newer.user_id = request.user_id
        AND newer.request_device_identifier = request.request_device_identifier
        AND newer.approved IS NULL
        AND newer.response_date IS NULL
        AND newer.creation_date > request.creation_date
    )`)
    .orderBy("request.creation_date", "desc")
    .execute();
}

export async function approveAuthRequest(
  db: Kysely<DB>,
  id: string,
  approved: boolean,
  responseDeviceIdentifier: string,
  key: string | null,
  masterPasswordHash: string | null,
): Promise<boolean> {
  const cutoff = now() - AUTH_REQUEST_TTL_SECONDS;
  const result = await db
    .updateTable("auth_requests")
    .set({
      approved: approved ? 1 : 0,
      response_device_identifier: responseDeviceIdentifier,
      key,
      master_password_hash: masterPasswordHash,
      response_date: now(),
    })
    .where("id", "=", id)
    .where("approved", "is", null)
    .where("response_date", "is", null)
    .where("authentication_date", "is", null)
    .where("consumption_token", "is", null)
    .where("creation_date", ">", cutoff)
    .where(sql<boolean>`NOT EXISTS (
      SELECT 1 FROM auth_requests newer
      WHERE newer.user_id = auth_requests.user_id
        AND newer.request_device_identifier = auth_requests.request_device_identifier
        AND newer.approved IS NULL
        AND newer.response_date IS NULL
        AND newer.creation_date > auth_requests.creation_date
    )`)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
