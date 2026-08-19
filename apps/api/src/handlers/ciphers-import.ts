import { vValidator } from "@hono/valibot-validator";
import type { EdgewardenBatchQuery } from "../services/db/d1-dialect";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { CipherImportSchema } from "../schemas/ciphers";
import { buildCipherData } from "../services/ciphers/presentation";
import { executeBatchInChunks, revisionQuery } from "../services/db/batch";
import * as foldersDb from "../services/db/folders";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";

export const importCiphers = factory.createHandlers(
  vValidator("json", CipherImportSchema),
  async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const returnCipherMap = c.req.query("returnCipherMap") === "1";
    const { folders, ciphers, folderRelationships } = c.req.valid("json");

    if (folders.length + ciphers.length > LIMITS.performance.importItemLimit) {
      return errorResponse(
        `Import exceeds maximum of ${LIMITS.performance.importItemLimit} items`,
        400,
      );
    }

    const timestamp = now();
    const folderIdMap = new Map<number, string>();
    const queries: EdgewardenBatchQuery[] = [];
    const ownedFolderIds = new Set(
      (await foldersDb.getFoldersByUserId(db, user.id)).map(
        (folder) => folder.id,
      ),
    );

    for (let index = 0; index < folders.length; index++) {
      const existingFolderId = folders[index].id;
      if (existingFolderId && ownedFolderIds.has(existingFolderId)) {
        folderIdMap.set(index, existingFolderId);
        continue;
      }
      const folderId = crypto.randomUUID();
      folderIdMap.set(index, folderId);
      queries.push(
        db.insertInto("folders").values({
          id: folderId,
          user_id: user.id,
          name: folders[index].name,
          created_at: timestamp,
          updated_at: timestamp,
        }),
      );
    }

    const cipherFolderMap = new Map<number, string>();
    for (const relationship of folderRelationships) {
      const folderId = folderIdMap.get(relationship.value);
      if (folderId) cipherFolderMap.set(relationship.key, folderId);
    }

    const cipherMap: Array<{
      index: number;
      sourceId: string | null;
      id: string;
    }> = [];
    for (let index = 0; index < ciphers.length; index++) {
      const cipher = ciphers[index];
      const folderId =
        cipherFolderMap.get(index) ||
        (cipher.folderId && ownedFolderIds.has(cipher.folderId)
          ? cipher.folderId
          : null);
      const sourceId = cipher.id ? String(cipher.id).trim() || null : null;
      const cipherId = crypto.randomUUID();
      queries.push(
        db.insertInto("ciphers").values({
          id: cipherId,
          user_id: user.id,
          org_id: null,
          type: cipher.type,
          folder_id: folderId,
          name: cipher.name,
          notes: cipher.notes ?? null,
          favorite: cipher.favorite ? 1 : 0,
          data: buildCipherData(cipher),
          fields: cipher.fields ? JSON.stringify(cipher.fields) : null,
          password_history: cipher.passwordHistory
            ? JSON.stringify(cipher.passwordHistory)
            : null,
          reprompt: cipher.reprompt ?? 0,
          key: cipher.key ?? null,
          created_at: timestamp,
          updated_at: timestamp,
        }),
      );
      cipherMap.push({ index, sourceId, id: cipherId });
    }

    queries.push(revisionQuery(db, user.id, timestamp));
    await executeBatchInChunks(
      c.get("dbDialect"),
      queries,
      LIMITS.performance.bulkMoveChunkSize,
    );

    return returnCipherMap
      ? c.json({ object: "import-result", cipherMap })
      : new Response(null, { status: 200 });
  },
);
