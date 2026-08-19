import { type Kysely, type Selectable, sql } from "kysely";
import type { DB, Devices } from "../../types/db";
import { now } from "../../utils/time";

export async function getDevice(
  db: Kysely<DB>,
  userId: string,
  deviceIdentifier: string,
): Promise<Selectable<Devices> | null> {
  return (
    (await db
      .selectFrom("devices")
      .selectAll()
      .where("user_id", "=", userId)
      .where("device_identifier", "=", deviceIdentifier)
      .executeTakeFirst()) ?? null
  );
}

export async function getDevicesByUserId(
  db: Kysely<DB>,
  userId: string,
): Promise<Selectable<Devices>[]> {
  return db
    .selectFrom("devices")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("updated_at", "desc")
    .execute();
}

export async function upsertDevice(
  db: Kysely<DB>,
  userId: string,
  deviceIdentifier: string,
  name: string,
  type: number,
  sessionStamp: string,
): Promise<void> {
  const ts = now();
  await db
    .insertInto("devices")
    .values({
      user_id: userId,
      device_identifier: deviceIdentifier,
      name,
      type,
      session_stamp: sessionStamp,
      created_at: ts,
      updated_at: ts,
    })
    .onConflict((oc) =>
      oc.columns(["user_id", "device_identifier"]).doUpdateSet({
        name,
        type,
        last_seen_at: ts,
        updated_at: ts,
      }),
    )
    .execute();
}

export async function updateDeviceKeys(
  db: Kysely<DB>,
  userId: string,
  deviceIdentifier: string,
  encryptedUserKey: string,
  encryptedPublicKey: string,
  encryptedPrivateKey: string,
  expectedSessionStamp: string | null,
  expectedMutationToken: string | null,
): Promise<boolean> {
  const timestamp = now();
  const result = await db
    .updateTable("devices")
    .set({
      encrypted_user_key: encryptedUserKey,
      encrypted_public_key: encryptedPublicKey,
      encrypted_private_key: encryptedPrivateKey,
      updated_at: sql<number>`MAX(updated_at + 1, ${timestamp})`,
      mutation_token: crypto.randomUUID(),
    })
    .where("user_id", "=", userId)
    .where("device_identifier", "=", deviceIdentifier)
    .where(sql<boolean>`session_stamp IS ${expectedSessionStamp}`)
    .where(sql<boolean>`mutation_token IS ${expectedMutationToken}`)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export async function updateDeviceName(
  db: Kysely<DB>,
  userId: string,
  deviceIdentifier: string,
  name: string,
  expectedSessionStamp: string | null,
  expectedMutationToken: string | null,
): Promise<boolean> {
  const timestamp = now();
  const result = await db
    .updateTable("devices")
    .set({
      name,
      updated_at: sql<number>`MAX(updated_at + 1, ${timestamp})`,
      mutation_token: crypto.randomUUID(),
    })
    .where("user_id", "=", userId)
    .where("device_identifier", "=", deviceIdentifier)
    .where(sql<boolean>`session_stamp IS ${expectedSessionStamp}`)
    .where(sql<boolean>`mutation_token IS ${expectedMutationToken}`)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export async function deleteDevice(
  db: Kysely<DB>,
  userId: string,
  deviceIdentifier: string,
): Promise<void> {
  await db
    .deleteFrom("devices")
    .where("user_id", "=", userId)
    .where("device_identifier", "=", deviceIdentifier)
    .execute();
}

/** Generate a fresh session stamp (UUID) for a new login session */
export function newSessionStamp(): string {
  return crypto.randomUUID();
}

/** Rotate session stamp — invalidates all existing tokens for this device */
export async function rotateSessionStamp(
  db: Kysely<DB>,
  userId: string,
  deviceIdentifier: string,
): Promise<string> {
  const stamp = crypto.randomUUID();
  await db
    .updateTable("devices")
    .set({ session_stamp: stamp, updated_at: now() })
    .where("user_id", "=", userId)
    .where("device_identifier", "=", deviceIdentifier)
    .execute();
  return stamp;
}
