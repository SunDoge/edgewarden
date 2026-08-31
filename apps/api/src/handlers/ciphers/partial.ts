import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { factory } from "../../http/factory";
import { CipherPartialSchema } from "../../schemas/ciphers";
import { conditionalCipherRevisionQuery } from "../../services/ciphers/access";
import { revisionQuery } from "../../services/db/batch";
import * as foldersDb from "../../services/db/folders";
import { errorResponse } from "../../utils/response";
import { now } from "../../utils/time";
import { loadCipherResponse } from "./response";

export const updateCipherPartial = factory.createHandlers(
  vValidator("json", CipherPartialSchema),
  async (c) => {
    const body = c.req.valid("json");
    const cipher = c.get("cipher");
    const db = c.get("db");
    const userId = c.get("user").id;
    if (
      body.folderId &&
      !(await foldersDb.getFolderById(db, body.folderId, userId))
    )
      return errorResponse("Folder not found", 400);

    const timestamp = Math.max(now(), cipher.updated_at + 1);
    if (cipher.org_id) {
      // Folder and favorite are per-user views for organization ciphers. A
      // read-only member may change them without mutating the shared item.
      await c.get("dbDialect").batch([
        db
          .insertInto("cipher_user_settings")
          .values({
            cipher_id: cipher.id,
            user_id: userId,
            folder_id: body.folderId ?? null,
            favorite: body.favorite ? 1 : 0,
            archived_at: cipher.archived_at,
            updated_at: timestamp,
          })
          .onConflict((conflict) =>
            conflict.columns(["cipher_id", "user_id"]).doUpdateSet({
              folder_id: body.folderId ?? null,
              favorite: body.favorite ? 1 : 0,
              updated_at: timestamp,
            }),
          ),
        revisionQuery(db, userId, timestamp),
      ]);
    } else {
      const mutationToken = crypto.randomUUID();
      const [updated] = await c.get("dbDialect").batch([
        db
          .updateTable("ciphers")
          .set({
            folder_id: body.folderId ?? null,
            favorite: body.favorite ? 1 : 0,
            updated_at: timestamp,
            mutation_token: mutationToken,
          })
          .where("id", "=", cipher.id)
          .where(sql<boolean>`mutation_token IS ${cipher.mutation_token}`),
        conditionalCipherRevisionQuery(db, cipher.id, mutationToken, timestamp),
      ]);
      if (updated.numAffectedRows !== 1n)
        return errorResponse("Cipher changed during partial update", 409);
    }

    const response = await loadCipherResponse(c, cipher.id);
    return response
      ? c.json(response)
      : errorResponse("Cipher changed while updating", 409);
  },
);
