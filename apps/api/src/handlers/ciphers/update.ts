import type { CipherInput } from "@edgewarden/shared";
import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import { sql } from "kysely";
import type { HonoEnv } from "../../env";
import { factory } from "../../http/factory";
import { CipherSchema, CipherShareSchema } from "../../schemas/ciphers";
import {
  conditionalCipherRevisionQuery,
  getCipherCollectionIds,
  getCipherPermissions,
  getVisibleCipherCollectionIds,
  organizationCipherViewStateQuery,
  resolveOrganizationCipherCollectionsForUpdate,
  validateOrganizationCollections,
} from "../../services/ciphers/access";
import {
  buildCipherData,
  cipherToResponse,
} from "../../services/ciphers/presentation";
import * as attachmentsDb from "../../services/db/attachments";
import * as ciphersDb from "../../services/db/ciphers";
import type { EdgewardenBatchQuery } from "../../services/db/d1-dialect";
import * as foldersDb from "../../services/db/folders";
import { errorResponse } from "../../utils/response";
import { now } from "../../utils/time";

// Mutation tokens bind follow-up collection and revision statements to the exact cipher update that committed.
// GET /api/ciphers/:id
export const getCipher = factory.createHandlers(async (c) => {
  const cipher = c.get("cipher");
  const db = c.get("db");
  const collectionIds = await getVisibleCipherCollectionIds(
    db,
    cipher.id,
    c.get("orgMember"),
  );
  const permissions = await getCipherPermissions(
    db,
    cipher,
    c.get("orgMember"),
    collectionIds,
  );
  return c.json(
    cipherToResponse(
      cipher,
      await attachmentsDb.listByCipherIds(db, [cipher.id]),
      collectionIds,
      permissions,
    ),
  );
});

// PUT /api/ciphers/:id
const updateCipherFromBody = async (c: Context<HonoEnv>, body: CipherInput) => {
  const user = c.get("user");
  const db = c.get("db");
  const cipher = c.get("cipher");
  const requestedOrganizationId = body.organizationId ?? null;
  const sharingPersonalCipher =
    cipher.org_id === null && requestedOrganizationId !== null;
  if (
    requestedOrganizationId !== (cipher.org_id ?? null) &&
    !sharingPersonalCipher
  )
    return errorResponse("Cipher ownership cannot be changed", 400);
  let collectionIds = body.collectionIds ?? [];
  if (!requestedOrganizationId && collectionIds.length)
    return errorResponse("Personal ciphers cannot use collections", 400);
  if (
    body.folderId &&
    !(await foldersDb.getFolderById(db, body.folderId, user.id))
  ) {
    return errorResponse("Folder not found", 400);
  }
  if (sharingPersonalCipher) {
    const access = await validateOrganizationCollections(
      db,
      user.id,
      requestedOrganizationId,
      collectionIds,
    );
    if ("error" in access && access.error)
      return errorResponse(
        access.error,
        access.error.includes("not found") ? 404 : 403,
      );
  } else if (cipher.org_id) {
    const member = c.get("orgMember");
    if (!member) return errorResponse("Organization not found", 404);
    const currentCollectionIds = await getCipherCollectionIds(db, cipher.id);
    const access = await resolveOrganizationCipherCollectionsForUpdate(
      db,
      member,
      cipher.org_id,
      currentCollectionIds,
      collectionIds,
    );
    if ("error" in access)
      return errorResponse(
        access.error,
        access.error.includes("not found") ? 404 : 403,
      );
    collectionIds = access.collectionIds;
  }
  if (body.lastKnownRevisionDate) {
    const expectedRevision = Math.floor(
      Date.parse(body.lastKnownRevisionDate) / 1000,
    );
    if (expectedRevision !== cipher.updated_at) {
      return errorResponse(
        "Cipher has been modified since it was last retrieved",
        409,
      );
    }
  }

  // Keep revisions monotonic even when two writes happen in the same second.
  const ts = Math.max(now(), cipher.updated_at + 1);
  const mutationToken = crypto.randomUUID();
  const updateQuery = db
    .updateTable("ciphers")
    .set({
      user_id: sharingPersonalCipher ? null : cipher.user_id,
      org_id: sharingPersonalCipher ? requestedOrganizationId : cipher.org_id,
      type: body.type,
      folder_id: requestedOrganizationId ? null : (body.folderId ?? null),
      name: body.name,
      notes: body.notes ?? null,
      favorite: requestedOrganizationId ? 0 : body.favorite ? 1 : 0,
      reprompt: body.reprompt ?? 0,
      key: body.key ?? null,
      data: buildCipherData(body),
      fields: body.fields ? JSON.stringify(body.fields) : null,
      password_history: body.passwordHistory
        ? JSON.stringify(body.passwordHistory)
        : null,
      updated_at: ts,
      mutation_token: mutationToken,
    })
    .where("id", "=", cipher.id)
    .$if(Boolean(body.lastKnownRevisionDate), (query) =>
      query.where("updated_at", "=", cipher.updated_at),
    );
  const committedCipher = db
    .selectFrom("ciphers")
    .select("id")
    .where("id", "=", cipher.id)
    .where("mutation_token", "=", mutationToken);
  const followupQueries: EdgewardenBatchQuery[] = [
    ...(requestedOrganizationId
      ? [
          organizationCipherViewStateQuery(db, {
            cipherId: cipher.id,
            userId: user.id,
            folderId: body.folderId ?? null,
            favorite: body.favorite ? 1 : 0,
            archivedAt: cipher.archived_at,
            updatedAt: ts,
            committedMutationToken: mutationToken,
          }),
        ]
      : []),
    db
      .deleteFrom("cipher_collections")
      .where("cipher_id", "=", cipher.id)
      .where(({ exists }) => exists(committedCipher)),
    ...collectionIds.map((collectionId) =>
      db
        .insertInto("cipher_collections")
        .columns(["cipher_id", "collection_id", "org_id"])
        .expression(
          db
            .selectNoFrom([
              sql<string>`${cipher.id}`.as("cipher_id"),
              sql<string>`${collectionId}`.as("collection_id"),
              sql<string>`${requestedOrganizationId}`.as("org_id"),
            ])
            .where(({ exists }) => exists(committedCipher)),
        ),
    ),
    conditionalCipherRevisionQuery(db, cipher.id, mutationToken, ts),
  ];
  const [updateResult] = await c
    .get("dbDialect")
    .batch([updateQuery, ...followupQueries]);
  if (updateResult.numAffectedRows === 0n) {
    return errorResponse(
      "Cipher has been modified since it was last retrieved",
      409,
    );
  }
  const updated = await ciphersDb.getCipherById(db, cipher.id, user.id);
  if (!updated) {
    console.error(
      JSON.stringify({
        event: "cipher.update_readback_missing",
        cipherId: cipher.id,
        userId: user.id,
      }),
    );
    return errorResponse("Cipher changed while updating", 409);
  }
  return c.json(
    cipherToResponse(
      updated,
      await attachmentsDb.listByCipherIds(db, [updated.id]),
      sharingPersonalCipher
        ? collectionIds
        : await getVisibleCipherCollectionIds(
            db,
            updated.id,
            c.get("orgMember"),
          ),
    ),
  );
};

export const updateCipher = factory.createHandlers(
  vValidator("json", CipherSchema),
  async (c) => updateCipherFromBody(c, c.req.valid("json")),
);

// PUT /api/ciphers/:id/share
export const shareCipher = factory.createHandlers(
  vValidator("json", CipherShareSchema),
  async (c) => {
    if (c.get("cipher").org_id !== null)
      return errorResponse("Cipher is already owned by an organization", 400);
    const body = c.req.valid("json");
    return updateCipherFromBody(c, {
      ...body.cipher,
      collectionIds: body.collectionIds,
    });
  },
);
