import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import { decryptCredential, encryptCredential } from "./credential-protection";

interface StoredSystemSetting<T> {
  key: string;
  value: T;
}

export async function loadSystemSetting<T>(
  db: Kysely<DB>,
  dataEncryptionSecret: string,
  key: string,
  validate: (value: unknown) => T,
): Promise<T | null> {
  const row = await db
    .selectFrom("config")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  if (!row) return null;
  const plaintext = await decryptCredential(
    row.value,
    dataEncryptionSecret,
    "system-settings",
  );
  const envelope = JSON.parse(plaintext) as StoredSystemSetting<unknown>;
  if (envelope.key !== key) throw new Error("System setting key mismatch");
  return validate(envelope.value);
}

export async function saveSystemSetting<T>(
  db: Kysely<DB>,
  dataEncryptionSecret: string,
  key: string,
  value: T,
): Promise<void> {
  const encrypted = await encryptCredential(
    JSON.stringify({ key, value } satisfies StoredSystemSetting<T>),
    dataEncryptionSecret,
    "system-settings",
  );
  await db
    .insertInto("config")
    .values({ key, value: encrypted })
    .onConflict((conflict) =>
      conflict.column("key").doUpdateSet({ value: encrypted }),
    )
    .execute();
}
