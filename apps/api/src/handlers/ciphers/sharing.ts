import type { CipherBulkShareInput } from "@edgewarden/shared";
import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { factory } from "../../http/factory";
import { redactedValidationHook } from "../../middleware/validation";
import { CipherBulkShareSchema } from "../../schemas/ciphers";
import {
  bulkCipherMutationClaimQuery,
  conditionalCipherRevisionQuery,
  organizationCipherViewStateQuery,
  validateOrganizationCollections,
} from "../../services/ciphers/access";
import { buildCipherData } from "../../services/ciphers/presentation";
import { textColumnInJson } from "../../services/db/json-array";
import { errorResponse } from "../../utils/response";
import { now } from "../../utils/time";
import { loadCipherResponse } from "./response";

export const shareCiphers = factory.createHandlers(
  vValidator("json", CipherBulkShareSchema, redactedValidationHook),
  async (c) => {
    const body: CipherBulkShareInput = c.req.valid("json");
    const firstRequest = body.ciphers.at(0);
    if (!firstRequest) throw new Error("Validated bulk share is empty");
    const organizationId = firstRequest.organizationId;
    const db = c.get("db");
    const user = c.get("user");
    const access = await validateOrganizationCollections(
      db,
      user.id,
      organizationId,
      body.collectionIds,
    );
    if ("error" in access && access.error)
      return errorResponse(
        access.error,
        access.error.includes("not found") ? 404 : 403,
      );

    const cipherIds = body.ciphers.map((cipher) => cipher.id);
    const existing = await db
      .selectFrom("ciphers")
      .selectAll()
      .where("user_id", "=", user.id)
      .where("org_id", "is", null)
      .where(textColumnInJson("id", cipherIds))
      .where("deleted_at", "is", null)
      .execute();
    if (existing.length !== cipherIds.length)
      return errorResponse("Trying to share ciphers that you do not own", 400);
    const existingById = new Map(existing.map((cipher) => [cipher.id, cipher]));
    for (const cipher of body.ciphers) {
      if (
        cipher.encryptedFor !== undefined &&
        cipher.encryptedFor !== null &&
        cipher.encryptedFor !== user.id
      )
        return errorResponse(
          "Cipher was not encrypted for the current user",
          400,
        );
      const current = existingById.get(cipher.id);
      if (!current) return errorResponse("Cipher not found", 409);
      if (
        cipher.lastKnownRevisionDate &&
        Math.floor(Date.parse(cipher.lastKnownRevisionDate) / 1000) !==
          current.updated_at
      )
        return errorResponse(
          "Cipher has been modified since it was last retrieved",
          409,
        );
    }

    const firstCipher = existing.at(0);
    if (!firstCipher) return errorResponse("Cipher not found", 409);
    const timestamp = now();
    const mutationToken = crypto.randomUUID();
    // Ownership transfer must be atomic across the selected items. The first
    // statement claims the complete personal snapshot or none of it.
    const [claimed] = await c.get("dbDialect").batch([
      bulkCipherMutationClaimQuery(db, existing, mutationToken, {
        userId: user.id,
      }),
      ...body.ciphers.flatMap((cipher) => {
        const current = existingById.get(cipher.id);
        if (!current) return [];
        const committed = db
          .selectFrom("ciphers")
          .select("id")
          .where("id", "=", cipher.id)
          .where("mutation_token", "=", mutationToken)
          .where("org_id", "=", organizationId);
        const updatedAt = Math.max(timestamp, current.updated_at + 1);
        return [
          db
            .updateTable("ciphers")
            .set({
              user_id: null,
              org_id: organizationId,
              type: cipher.type,
              folder_id: null,
              name: cipher.name,
              notes: cipher.notes ?? null,
              favorite: 0,
              reprompt: cipher.reprompt ?? 0,
              key: cipher.key ?? null,
              data: buildCipherData(cipher),
              fields: cipher.fields ? JSON.stringify(cipher.fields) : null,
              password_history: cipher.passwordHistory
                ? JSON.stringify(cipher.passwordHistory)
                : null,
              updated_at: updatedAt,
            })
            .where("id", "=", cipher.id)
            .where("user_id", "=", user.id)
            .where("mutation_token", "=", mutationToken),
          organizationCipherViewStateQuery(db, {
            cipherId: cipher.id,
            userId: user.id,
            folderId: cipher.folderId ?? null,
            favorite: cipher.favorite ? 1 : 0,
            archivedAt: current.archived_at,
            updatedAt,
            committedMutationToken: mutationToken,
          }),
          db
            .deleteFrom("cipher_collections")
            .where("cipher_id", "=", cipher.id)
            .where(({ exists }) => exists(committed)),
          ...body.collectionIds.map((collectionId) =>
            db
              .insertInto("cipher_collections")
              .columns(["cipher_id", "collection_id", "org_id"])
              .expression(
                db
                  .selectNoFrom([
                    sql<string>`${cipher.id}`.as("cipher_id"),
                    sql<string>`${collectionId}`.as("collection_id"),
                    sql<string>`${organizationId}`.as("org_id"),
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
    if (claimed.numAffectedRows !== BigInt(existing.length))
      return errorResponse("Ciphers changed during sharing", 409);

    const responses = [];
    for (const cipher of body.ciphers) {
      const response = await loadCipherResponse(c, cipher.id, access.member);
      if (!response) return errorResponse("Cipher changed while sharing", 409);
      responses.push(response);
    }
    return c.json({ data: responses, object: "list", continuationToken: null });
  },
);
