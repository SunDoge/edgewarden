import type {
  CipherBulkCollectionsInput,
  CipherCollectionsInput,
} from "@edgewarden/shared";
import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import { sql } from "kysely";
import type { HonoEnv } from "../../env";
import { factory } from "../../http/factory";
import { redactedValidationHook } from "../../middleware/validation";
import {
  CipherBulkCollectionsSchema,
  CipherCollectionsSchema,
} from "../../schemas/ciphers";
import {
  bulkCipherMutationClaimQuery,
  conditionalCipherRevisionQuery,
  getCipherCollectionIds,
  getCipherPermissions,
  resolveOrganizationCipherCollectionsForUpdate,
  validateOrganizationCollections,
} from "../../services/ciphers/access";
import { textColumnInJson } from "../../services/db/json-array";
import { errorResponse } from "../../utils/response";
import { now } from "../../utils/time";
import { loadCipherResponse } from "./response";

async function updateCollections(
  c: Context<HonoEnv, string, { out: { json: CipherCollectionsInput } }>,
  v2: boolean,
) {
  const { collectionIds } = c.req.valid("json");
  const cipher = c.get("cipher");
  const member = c.get("orgMember");
  if (!cipher.org_id || !member) return errorResponse("Not found", 404);
  const db = c.get("db");
  const current = await getCipherCollectionIds(db, cipher.id);
  const access = await resolveOrganizationCipherCollectionsForUpdate(
    db,
    member,
    cipher.org_id,
    current,
    collectionIds,
  );
  if ("error" in access)
    return errorResponse(
      access.error,
      access.error.includes("not found") ? 404 : 403,
    );

  const timestamp = Math.max(now(), cipher.updated_at + 1);
  const mutationToken = crypto.randomUUID();
  // Link replacement is conditional on this exact cipher update winning, so
  // a stale request cannot overwrite links after a newer item edit.
  const committed = db
    .selectFrom("ciphers")
    .select("id")
    .where("id", "=", cipher.id)
    .where("mutation_token", "=", mutationToken);
  const [updated] = await c.get("dbDialect").batch([
    db
      .updateTable("ciphers")
      .set({ updated_at: timestamp, mutation_token: mutationToken })
      .where("id", "=", cipher.id)
      .where(sql<boolean>`mutation_token IS ${cipher.mutation_token}`),
    db
      .deleteFrom("cipher_collections")
      .where("cipher_id", "=", cipher.id)
      .where(({ exists }) => exists(committed)),
    ...access.collectionIds.map((collectionId) =>
      db
        .insertInto("cipher_collections")
        .columns(["cipher_id", "collection_id", "org_id"])
        .expression(
          db
            .selectNoFrom([
              sql<string>`${cipher.id}`.as("cipher_id"),
              sql<string>`${collectionId}`.as("collection_id"),
              sql<string>`${cipher.org_id}`.as("org_id"),
            ])
            .where(({ exists }) => exists(committed)),
        ),
    ),
    conditionalCipherRevisionQuery(db, cipher.id, mutationToken, timestamp),
  ]);
  if (updated.numAffectedRows !== 1n)
    return errorResponse("Cipher changed during collection update", 409);
  const response = await loadCipherResponse(c, cipher.id);
  if (!response) return errorResponse("Cipher changed while updating", 409);
  return v2
    ? c.json({ unavailable: false, cipher: response })
    : c.json(response);
}

export const updateCipherCollections = factory.createHandlers(
  vValidator("json", CipherCollectionsSchema, redactedValidationHook),
  async (c) => updateCollections(c, false),
);

export const updateCipherCollectionsV2 = factory.createHandlers(
  vValidator("json", CipherCollectionsSchema, redactedValidationHook),
  async (c) => updateCollections(c, true),
);

export const updateCipherCollectionsBulk = factory.createHandlers(
  vValidator("json", CipherBulkCollectionsSchema),
  async (c) => {
    const body: CipherBulkCollectionsInput = c.req.valid("json");
    const db = c.get("db");
    const access = await validateOrganizationCollections(
      db,
      c.get("user").id,
      body.organizationId,
      body.collectionIds,
    );
    if ("error" in access && access.error)
      return errorResponse(
        access.error,
        access.error.includes("not found") ? 404 : 403,
      );
    const cipherIds = [...new Set(body.cipherIds)];
    const ciphers = await db
      .selectFrom("ciphers")
      .selectAll()
      .where("org_id", "=", body.organizationId)
      .where(textColumnInJson("id", cipherIds))
      .where("deleted_at", "is", null)
      .execute();
    if (ciphers.length !== cipherIds.length)
      return errorResponse("Cipher not found", 404);

    const updates: Array<{
      cipher: (typeof ciphers)[number];
      collectionIds: string[];
    }> = [];
    for (const cipher of ciphers) {
      const current = await getCipherCollectionIds(db, cipher.id);
      const permissions = await getCipherPermissions(
        db,
        cipher,
        access.member,
        current,
      );
      if (!permissions.edit) return errorResponse("Cipher not found", 404);
      const requested = body.removeCollections
        ? current.filter((id) => !body.collectionIds.includes(id))
        : [...new Set([...current, ...body.collectionIds])];
      const resolved = await resolveOrganizationCipherCollectionsForUpdate(
        db,
        access.member,
        body.organizationId,
        current,
        requested,
      );
      if ("error" in resolved)
        return errorResponse(
          resolved.error,
          resolved.error.includes("not found") ? 404 : 403,
        );
      updates.push({ cipher, collectionIds: resolved.collectionIds });
    }

    const firstCipher = ciphers.at(0);
    if (!firstCipher) return errorResponse("Cipher not found", 404);
    const timestamp = now();
    const mutationToken = crypto.randomUUID();
    // Claim the complete snapshot before changing any links. The shared token
    // fences every follow-up statement in the same transactional D1 batch.
    const [claimed] = await c.get("dbDialect").batch([
      bulkCipherMutationClaimQuery(db, ciphers, mutationToken, {
        organizationId: body.organizationId,
      }),
      ...updates.flatMap(({ cipher, collectionIds }) => {
        const committed = db
          .selectFrom("ciphers")
          .select("id")
          .where("id", "=", cipher.id)
          .where("mutation_token", "=", mutationToken);
        return [
          db
            .updateTable("ciphers")
            .set({ updated_at: Math.max(timestamp, cipher.updated_at + 1) })
            .where("id", "=", cipher.id)
            .where("mutation_token", "=", mutationToken),
          db
            .deleteFrom("cipher_collections")
            .where("cipher_id", "=", cipher.id)
            .where(({ exists }) => exists(committed)),
          ...collectionIds.map((collectionId) =>
            db
              .insertInto("cipher_collections")
              .columns(["cipher_id", "collection_id", "org_id"])
              .expression(
                db
                  .selectNoFrom([
                    sql<string>`${cipher.id}`.as("cipher_id"),
                    sql<string>`${collectionId}`.as("collection_id"),
                    sql<string>`${body.organizationId}`.as("org_id"),
                  ])
                  .where(({ exists }) => exists(committed)),
              ),
          ),
        ];
      }),
      conditionalCipherRevisionQuery(
        db,
        firstCipher.id,
        mutationToken,
        timestamp,
      ),
    ]);
    if (claimed.numAffectedRows !== BigInt(ciphers.length))
      return errorResponse("Ciphers changed during collection update", 409);
    return new Response(null, { status: 200 });
  },
);
