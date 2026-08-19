import type { Kysely, Selectable, Insertable } from "kysely";
import type { DB, Users } from "../../types/db";

export async function getUserByEmail(
  db: Kysely<DB>,
  email: string,
): Promise<Selectable<Users> | null> {
  return (
    (await db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", email.toLowerCase())
      .executeTakeFirst()) ?? null
  );
}

export async function getUserById(
  db: Kysely<DB>,
  id: string,
): Promise<Selectable<Users> | null> {
  return (
    (await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()) ?? null
  );
}

export async function getUserCount(db: Kysely<DB>): Promise<number> {
  const row = await db
    .selectFrom("users")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function createUser(
  db: Kysely<DB>,
  user: Insertable<Users>,
): Promise<void> {
  await db.insertInto("users").values(user).execute();
}

export async function updateUser(
  db: Kysely<DB>,
  id: string,
  data: Partial<Omit<Insertable<Users>, "id" | "created_at">>,
): Promise<void> {
  await db.updateTable("users").set(data).where("id", "=", id).execute();
}

export async function getAllUsersForBackup(
  db: Kysely<DB>,
): Promise<Pick<Selectable<Users>, "id" | "public_key" | "role" | "status">[]> {
  return await db
    .selectFrom("users")
    .select(["id", "public_key", "role", "status"])
    .execute();
}
