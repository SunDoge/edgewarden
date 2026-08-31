import type { CipherInput } from "@edgewarden/shared";
import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import type { HonoEnv } from "../../env";
import { factory } from "../../http/factory";
import { redactedValidationHook } from "../../middleware/validation";
import { CipherCreateSchema, CipherSchema } from "../../schemas/ciphers";
import {
  revisionQueriesForCipher,
  validateOrganizationCollections,
} from "../../services/ciphers/access";
import {
  buildCipherData,
  cipherToResponse,
} from "../../services/ciphers/presentation";
import { executeBatch } from "../../services/db/batch";
import * as ciphersDb from "../../services/db/ciphers";
import * as foldersDb from "../../services/db/folders";
import { errorResponse } from "../../utils/response";
import { now } from "../../utils/time";

// Creation validates organization and collection ownership before compiling the atomic write batch.
async function createCipherFromBody(c: Context<HonoEnv>, body: CipherInput) {
  const user = c.get("user");
  const db = c.get("db");
  const id = crypto.randomUUID();
  const ts = now();
  const organizationId = body.organizationId ?? null;
  const collectionIds = body.collectionIds ?? [];
  if (!organizationId && collectionIds.length)
    return errorResponse("Personal ciphers cannot use collections", 400);
  if (
    body.folderId &&
    !(await foldersDb.getFolderById(db, body.folderId, user.id))
  ) {
    return errorResponse("Folder not found", 400);
  }

  const access = organizationId
    ? await validateOrganizationCollections(
        db,
        user.id,
        organizationId,
        collectionIds,
      )
    : null;
  if (access && "error" in access && access.error)
    return errorResponse(
      access.error,
      access.error.includes("not found") ? 404 : 403,
    );
  const values = {
    id,
    user_id: organizationId ? null : user.id,
    org_id: organizationId,
    type: body.type,
    folder_id: organizationId ? null : (body.folderId ?? null),
    name: body.name,
    notes: body.notes ?? null,
    favorite: organizationId ? 0 : body.favorite ? 1 : 0,
    reprompt: body.reprompt ?? 0,
    key: body.key ?? null,
    data: buildCipherData(body),
    fields: body.fields ? JSON.stringify(body.fields) : null,
    password_history: body.passwordHistory
      ? JSON.stringify(body.passwordHistory)
      : null,
    created_at: ts,
    updated_at: ts,
  };
  const owner = {
    user_id: organizationId ? null : user.id,
    org_id: organizationId,
  };
  await executeBatch(c.get("dbDialect"), [
    db.insertInto("ciphers").values(values),
    ...(organizationId
      ? [
          db.insertInto("cipher_user_settings").values({
            cipher_id: id,
            user_id: user.id,
            folder_id: body.folderId ?? null,
            favorite: body.favorite ? 1 : 0,
            archived_at: null,
            updated_at: ts,
          }),
        ]
      : []),
    ...(organizationId
      ? collectionIds.map((collectionId) =>
          db.insertInto("cipher_collections").values({
            cipher_id: id,
            collection_id: collectionId,
            org_id: organizationId,
          }),
        )
      : []),
    ...(await revisionQueriesForCipher(db, owner, ts)),
  ]);

  const created = await ciphersDb.getCipherById(db, id, user.id);
  if (!created) {
    console.error(
      JSON.stringify({
        event: "cipher.create_readback_missing",
        cipherId: id,
        userId: user.id,
      }),
    );
    return errorResponse("Cipher could not be read after creation", 500);
  }
  return c.json(cipherToResponse(created, [], collectionIds), 200);
}

// POST /api/ciphers
export const createCipher = factory.createHandlers(
  vValidator("json", CipherSchema, redactedValidationHook),
  (c) => createCipherFromBody(c, c.req.valid("json")),
);

// POST /api/ciphers/create uses the same wrapper as sharing in native clients.
export const createCipherInOrganization = factory.createHandlers(
  vValidator("json", CipherCreateSchema, redactedValidationHook),
  (c) => {
    const body = c.req.valid("json");
    return createCipherFromBody(
      c,
      "cipher" in body
        ? { ...body.cipher, collectionIds: body.collectionIds }
        : body,
    );
  },
);
