import { type Kysely, sql } from "kysely";
import type { DB } from "../../types/db";
import { now } from "../../utils/time";

export async function getRevisionDate(
  db: Kysely<DB>,
  userId: string,
): Promise<number> {
  const row = await db
    .selectFrom("user_revisions")
    .select("revision_date")
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return (row?.revision_date ?? 0) * 1000;
}

export async function getRevisionValue(
  db: Kysely<DB>,
  userId: string,
): Promise<number> {
  const row = await db
    .selectFrom("user_revisions")
    .select("revision_date")
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row?.revision_date ?? 0;
}

export async function readAtStableRevision<T>(args: {
  readRevision: () => Promise<number>;
  read: () => Promise<T>;
  maxAttempts?: number;
}): Promise<T | null> {
  const maxAttempts = args.maxAttempts ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await args.readRevision();
    const value = await args.read();
    if ((await args.readRevision()) === before) return value;
  }
  return null;
}

export async function touchRevision(
  db: Kysely<DB>,
  userId: string,
): Promise<void> {
  await db
    .insertInto("user_revisions")
    .values({ user_id: userId, revision_date: now() })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({
        revision_date: sql<number>`MAX(user_revisions.revision_date + 1, excluded.revision_date)`,
      }),
    )
    .execute();
}
