import type { D1Dialect, EdgewardenBatchQuery } from "./db/d1-dialect";
import { type Kysely, sql } from "kysely";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import { type AuditEventInput, auditEventInsertQuery } from "./audit";

export interface AccountDeletionResult {
  ciphers: number;
  sends: number;
}

export async function deleteAccountData(
  db: Kysely<DB>,
  dialect: D1Dialect,
  userId: string,
  auditEvent?: AuditEventInput,
): Promise<AccountDeletionResult | null> {
  const timestamp = now();
  const deletionToken = crypto.randomUUID();
  const archivedIdentity = {
    deleted_email: sql<string>`email`,
    master_password_salt: sql<string>`COALESCE(master_password_salt, email)`,
    email: `deleted-${deletionToken}@deleted.invalid`,
  };
  const ownsDeletion = db
    .selectFrom("users")
    .select("id")
    .where("id", "=", userId)
    .where("security_stamp", "=", deletionToken)
    .where("deletion_requested_at", "=", timestamp);
  const statements: EdgewardenBatchQuery[] = [
    db
      .updateTable("users")
      .set({
        status: "banned",
        // Keep the encrypted records and original KDF identity, but release the
        // unique login address so a replacement account gets a fresh user id.
        ...archivedIdentity,
        deletion_requested_at: timestamp,
        security_stamp: deletionToken,
        updated_at: timestamp,
      })
      .where("id", "=", userId)
      .where("deletion_requested_at", "is", null)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("org_members")
              .select("id")
              .where("user_id", "=", userId)
              .where("role", "=", "owner")
              .where("status", "=", "confirmed"),
          ),
        ),
      ),
    db
      .updateTable("ciphers")
      .set({
        deleted_at: timestamp,
        purge_after: timestamp,
        updated_at: timestamp,
      })
      .where("user_id", "=", userId)
      .where(({ exists }) => exists(ownsDeletion)),
    db
      .updateTable("sends")
      .set({ deletion_date: timestamp, updated_at: timestamp })
      .where("user_id", "=", userId)
      .where(({ exists }) => exists(ownsDeletion)),
    db
      .deleteFrom("refresh_tokens")
      .where("user_id", "=", userId)
      .where(({ exists }) => exists(ownsDeletion)),
    db
      .deleteFrom("org_members")
      .where("user_id", "=", userId)
      .where(({ exists }) => exists(ownsDeletion)),
  ];
  if (auditEvent)
    statements.push(
      auditEventInsertQuery(
        db,
        auditEvent,
        sql<boolean>`EXISTS (
					SELECT 1 FROM users
					WHERE id = ${userId}
					  AND security_stamp = ${deletionToken}
					  AND deletion_requested_at = ${timestamp}
				)`,
        timestamp,
      ),
    );
  const [deletedUser, deletedCiphers, deletedSends] =
    await dialect.batch(statements);
  if (deletedUser.numAffectedRows !== 1n) {
    // A retained tombstone is already deleted, not an organization owner.
    // This also makes concurrent/retried administrative deletion idempotent.
    const deleted = await db
      .selectFrom("users")
      .select(["id", "deleted_email"])
      .where("id", "=", userId)
      .where("deletion_requested_at", "is not", null)
      .executeTakeFirst();
    if (deleted && deleted.deleted_email === null) {
      // The previous Worker can still delete an account between migration and
      // upload. Reconcile that tombstone without repeating the deletion event.
      await db
        .updateTable("users")
        .set(archivedIdentity)
        .where("id", "=", userId)
        .where("deletion_requested_at", "is not", null)
        .where("deleted_email", "is", null)
        .execute();
    }
    return deleted ? { ciphers: 0, sends: 0 } : null;
  }
  return {
    ciphers: Number(deletedCiphers.numAffectedRows ?? 0n),
    sends: Number(deletedSends.numAffectedRows ?? 0n),
  };
}
