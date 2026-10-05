import type { Kysely, Selectable } from "kysely";
import type { AttachmentUploads, DB } from "../../types/db";

export async function getPendingAttachmentUpload(
  db: Kysely<DB>,
  id: string,
  cipherId: string,
  timestamp: number,
): Promise<Selectable<AttachmentUploads> | null> {
  return (
    (await db
      .selectFrom("attachment_uploads")
      .selectAll()
      .where("id", "=", id)
      .where("cipher_id", "=", cipherId)
      .where("expires_at", ">", timestamp)
      .executeTakeFirst()) ?? null
  );
}
