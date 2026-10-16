import type { CipherInput } from "@edgewarden/shared";
import { type Kysely, type RawBuilder, type Selectable, sql } from "kysely";
import type { Ciphers, DB } from "../../types/db";
import type { EdgewardenBatchQuery } from "../db/d1-dialect";

/** Plan metadata changes without ever trusting a client-supplied attachment ID. */
export async function prepareCipherAttachmentMutation(
  db: Kysely<DB>,
  cipher: Selectable<Ciphers>,
  body: CipherInput,
  mutationToken: string,
  sharing: boolean,
): Promise<
  | { error: string }
  | { guard: RawBuilder<boolean>; queries: EdgewardenBatchQuery[] }
> {
  const updates = Object.entries(body.attachments2 ?? {});
  if (!sharing && !updates.length)
    return { guard: sql<boolean>`true`, queries: [] };
  const attachments = await db
    .selectFrom("attachments")
    .select(["id", "file_name", "key"])
    .where("cipher_id", "=", cipher.id)
    .where("deleted_at", "is", null)
    .execute();
  const ids = new Set(attachments.map((attachment) => attachment.id));
  if (updates.some(([id]) => !ids.has(id)))
    return { error: "Attachment not found on this cipher" };
  // Without an item key, attachment metadata is encrypted with the previous
  // owner's key. Require a complete rewrap instead of accepting broken sharing.
  if (
    sharing &&
    !cipher.key &&
    attachments.some((attachment) => !body.attachments2?.[attachment.id])
  )
    return {
      error: "Sharing this cipher requires re-encrypted attachment metadata",
    };

  const snapshot = JSON.stringify(attachments);
  // Fence the complete attachment snapshot as well as the item. Upload/delete
  // operations can change attachments independently of the item's mutation token.
  const guard = sql<boolean>`
    (SELECT COUNT(*) FROM attachments WHERE cipher_id = ${cipher.id} AND deleted_at IS NULL) = ${attachments.length}
    AND NOT EXISTS (
      SELECT 1 FROM json_each(${snapshot}) expected
      WHERE NOT EXISTS (
        SELECT 1 FROM attachments current
        WHERE current.id = json_extract(expected.value, '$.id')
          AND current.cipher_id = ${cipher.id} AND current.deleted_at IS NULL
          AND current.file_name = json_extract(expected.value, '$.file_name')
          AND current.key IS json_extract(expected.value, '$.key')
      )
    )
    AND ${sharing ? sql<boolean>`NOT EXISTS (SELECT 1 FROM attachment_uploads WHERE cipher_id = ${cipher.id})` : sql<boolean>`true`}
  `;
  const committed = db
    .selectFrom("ciphers")
    .select("id")
    .where("id", "=", cipher.id)
    .where("mutation_token", "=", mutationToken);
  return {
    guard,
    queries: updates.map(([id, metadata]) =>
      db
        .updateTable("attachments")
        .set({ file_name: metadata.fileName, key: metadata.key })
        .where("id", "=", id)
        .where("cipher_id", "=", cipher.id)
        .where("deleted_at", "is", null)
        .where(({ exists }) => exists(committed)),
    ),
  };
}
