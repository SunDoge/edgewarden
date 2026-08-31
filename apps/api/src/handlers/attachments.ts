import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { redactedValidationHook } from "../middleware/validation";
import { CreateAttachmentSchema } from "../schemas/attachments";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import { discardUnpublishedBlob } from "../services/blob-gc";
import {
  createAttachmentUploadObjectKey,
  getBlobObject,
  getBlobStorageMaxBytes,
  putBlobObject,
} from "../services/blob-store";
import {
  getCipherPermissions,
  getVisibleCipherCollectionIds,
} from "../services/ciphers/access";
import { cipherToResponse } from "../services/ciphers/presentation";
import * as attachmentsDb from "../services/db/attachments";
import {
  attachmentCipherUpdateQuery,
  attachmentRevisionQuery,
  deletedAttachmentCipherUpdateQuery,
  deletedAttachmentRevisionQuery,
  executeBatch,
} from "../services/db/batch";
import * as ciphersDb from "../services/db/ciphers";
import { textColumnInJson } from "../services/db/json-array";
import {
  buildDirectUploadUrl,
  getSafeJwtSecret,
  parseDirectUploadPayload,
} from "../utils/direct-upload";
import {
  createAttachmentDownloadToken,
  createAttachmentUploadToken,
  verifyAttachmentDownloadToken,
  verifyAttachmentUploadToken,
} from "../utils/jwt";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";

async function canUploadAttachment(
  db: any,
  cipher: { id: string; user_id: string | null; org_id: string | null },
  userId: string,
) {
  if (cipher.user_id) return cipher.user_id === userId;
  if (!cipher.org_id) return false;
  const member = await db
    .selectFrom("org_members")
    .selectAll()
    .where("org_id", "=", cipher.org_id)
    .where("user_id", "=", userId)
    .where("status", "=", "confirmed")
    .executeTakeFirst();
  if (!member) return false;
  if (["manager", "admin", "owner"].includes(member.role) || member.access_all)
    return true;
  const links = await db
    .selectFrom("cipher_collections")
    .select("collection_id")
    .where("cipher_id", "=", cipher.id)
    .execute();
  if (!links.length) return false;
  const writable = await db
    .selectFrom("collection_members")
    .select("collection_id")
    .where("org_member_id", "=", member.id)
    .where(
      textColumnInJson(
        "collection_id",
        links.map((link: any) => link.collection_id),
      ),
    )
    .where("read_only", "=", 0)
    .execute();
  return writable.length === links.length;
}

function sizeName(bytes: number): string {
  if (bytes < 1024) return `${bytes} Bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const createAttachment = factory.createHandlers(
  vValidator("json", CreateAttachmentSchema, redactedValidationHook),
  async (c) => {
    const cipher = c.get("cipher");
    const body = c.req.valid("json");
    const secret = getSafeJwtSecret(c.env);
    if (!secret) return errorResponse("Server configuration error", 500);
    const maxBytes = getBlobStorageMaxBytes(
      c.env,
      LIMITS.attachment.maxFileSizeBytes,
    );
    if (body.fileSize > maxBytes)
      return errorResponse("Attachment storage limit exceeded", 413);

    const id = crypto.randomUUID();
    const db = c.get("db");
    const attachments = await attachmentsDb.listByCipherIds(db, [cipher.id]);
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
    const pendingAttachment = {
      id,
      cipher_id: cipher.id,
      file_name: body.fileName,
      size: body.fileSize,
      size_name: sizeName(body.fileSize),
      key: body.key,
      storage_key: null,
      deleted_at: null,
      deletion_token: null,
      created_at: now(),
    };
    const token = await createAttachmentUploadToken(
      c.get("user").id,
      cipher.id,
      id,
      {
        fileName: body.fileName,
        key: body.key,
        fileSize: body.fileSize,
      },
      secret,
    );
    return c.json({
      object: "attachment-fileUpload",
      attachmentId: id,
      fileUploadType: 1,
      cipherResponse: cipherToResponse(
        cipher,
        [...attachments, pendingAttachment],
        collectionIds,
        permissions,
        "cipher",
      ),
      url: buildDirectUploadUrl(
        c.req.raw,
        `/api/ciphers/${cipher.id}/attachment/${id}`,
        token,
      ),
    });
  },
);

export const uploadAttachment = factory.createHandlers(async (c) => {
  const secret = getSafeJwtSecret(c.env);
  if (!secret) return errorResponse("Server configuration error", 500);
  const token = c.req.query("token");
  if (!token) return errorResponse("Upload token required", 401);
  const claims = await verifyAttachmentUploadToken(token, secret);
  if (
    !claims ||
    claims.cipherId !== c.req.param("id") ||
    claims.attachmentId !== c.req.param("attachmentId")
  )
    return errorResponse("Invalid or expired upload token", 401);
  const cipher = await ciphersDb.getCipherById(
    c.get("db"),
    claims.cipherId,
    claims.userId,
  );
  const attachment = await attachmentsDb.getByIdIncludingDeleted(
    c.get("db"),
    claims.attachmentId,
  );
  if (
    !cipher ||
    !(await canUploadAttachment(c.get("db"), cipher, claims.userId))
  )
    return errorResponse("Attachment not found", 404);
  if (attachment) {
    return attachment.cipher_id === cipher.id && attachment.deleted_at === null
      ? new Response(null, { status: 201 })
      : errorResponse("Attachment not found", 404);
  }
  const upload = await parseDirectUploadPayload(c.req.raw, {
    expectedSize: claims.fileSize,
    maxFileSize: getBlobStorageMaxBytes(
      c.env,
      LIMITS.attachment.maxFileSizeBytes,
    ),
    tooLargeMessage: "Attachment storage limit exceeded",
    sizeMismatchMessage: "Attachment size does not match metadata",
  });
  if (upload instanceof Response) return upload;
  const objectKey = createAttachmentUploadObjectKey(
    cipher.id,
    claims.attachmentId,
  );
  try {
    await putBlobObject(c.env, objectKey, upload.body, {
      size: upload.size,
      contentType: "application/octet-stream",
      customMetadata: {
        cipherId: cipher.id,
        attachmentId: claims.attachmentId,
      },
    });
    const ts = Math.max(now(), cipher.updated_at + 1);
    await executeBatch(c.get("dbDialect"), [
      c
        .get("db")
        .insertInto("attachments")
        .values({
          id: claims.attachmentId,
          cipher_id: cipher.id,
          file_name: claims.fileName,
          size: claims.fileSize,
          size_name: sizeName(claims.fileSize),
          key: claims.key,
          storage_key: objectKey,
          created_at: ts,
        })
        .onConflict((conflict) => conflict.column("id").doNothing()),
      attachmentCipherUpdateQuery(
        c.get("db"),
        cipher.id,
        claims.attachmentId,
        objectKey,
        ts,
      ),
      attachmentRevisionQuery(c.get("db"), claims.attachmentId, objectKey, ts),
    ]);
  } catch (error) {
    await discardUnpublishedBlob(c.env, objectKey).catch(() => undefined);
    throw error;
  }
  const published = await attachmentsDb.getByIdIncludingDeleted(
    c.get("db"),
    claims.attachmentId,
  );
  if (published?.storage_key !== objectKey) {
    await discardUnpublishedBlob(c.env, objectKey);
  }
  return new Response(null, { status: 201 });
});

export const getAttachment = factory.createHandlers(async (c) => {
  const cipher = c.get("cipher");
  const attachmentId = c.req.param("attachmentId");
  if (!attachmentId) return errorResponse("Attachment id required", 400);
  const attachment = await attachmentsDb.getById(c.get("db"), attachmentId);
  if (!attachment || attachment.cipher_id !== cipher.id)
    return errorResponse("Attachment not found", 404);
  const secret = getSafeJwtSecret(c.env);
  if (!secret || !attachment.storage_key)
    return errorResponse("Attachment content not found", 404);
  const token = await createAttachmentDownloadToken(
    c.get("user").id,
    cipher.id,
    attachment.id,
    attachment.storage_key,
    secret,
  );
  return c.json({
    object: "attachment",
    id: attachment.id,
    url: buildDirectUploadUrl(c.req.raw, "/api/attachments/download", token),
    fileName: attachment.file_name,
    key: attachment.key,
    size: String(attachment.size),
    sizeName: attachment.size_name,
  });
});

export const downloadAttachment = factory.createHandlers(async (c) => {
  const secret = getSafeJwtSecret(c.env);
  const token = c.req.query("token");
  if (!secret || !token) return errorResponse("Download token required", 401);
  const claims = await verifyAttachmentDownloadToken(token, secret);
  if (!claims) return errorResponse("Invalid or expired download token", 401);
  const attachment = await attachmentsDb.getById(
    c.get("db"),
    claims.attachmentId,
  );
  if (
    !attachment ||
    attachment.cipher_id !== claims.cipherId ||
    attachment.storage_key !== claims.storageKey
  )
    return errorResponse("Attachment not found", 404);
  const object = await getBlobObject(c.env, claims.storageKey);
  if (!object?.body) return errorResponse("Attachment content not found", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
    },
  });
});

export const deleteAttachment = factory.createHandlers(async (c) => {
  const cipher = c.get("cipher");
  const id = c.req.param("attachmentId");
  if (!id) return errorResponse("Attachment id required", 400);
  const attachment = await attachmentsDb.getById(c.get("db"), id);
  if (!attachment || attachment.cipher_id !== cipher.id)
    return errorResponse("Attachment not found", 404);
  const ts = Math.max(now(), cipher.updated_at + 1);
  const deletionToken = crypto.randomUUID();
  const [deleted] = await c.get("dbDialect").batch([
    c
      .get("db")
      .updateTable("attachments")
      .set({ deleted_at: ts, deletion_token: deletionToken })
      .where("id", "=", id)
      .where("cipher_id", "=", cipher.id)
      .where("deleted_at", "is", null),
    deletedAttachmentCipherUpdateQuery(
      c.get("db"),
      cipher.id,
      id,
      deletionToken,
      ts,
    ),
    deletedAttachmentRevisionQuery(c.get("db"), id, deletionToken, ts),
    auditEventInsertQuery(
      c.get("db"),
      {
        actorUserId: c.get("user").id,
        action: "attachment.delete",
        category: "vault",
        targetType: "attachment",
        targetId: id,
        metadata: {
          ...auditRequestMetadata(c.req.raw),
          cipherId: cipher.id,
        },
      },
      sql<boolean>`EXISTS (
					SELECT 1 FROM attachments
					WHERE id = ${id} AND deletion_token = ${deletionToken}
				)`,
      ts,
    ),
  ]);
  if (deleted.numAffectedRows !== 1n)
    return errorResponse("Attachment not found", 404);
  return new Response(null, { status: 204 });
});
