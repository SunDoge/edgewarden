import { vValidator } from "@hono/valibot-validator";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { CreateFileSendSchema } from "../schemas/sends";
import {
  getBlobStorageMaxBytes,
  getSendFileObjectKey,
} from "../services/blob-store";
import { executeBatch, revisionQuery } from "../services/db/batch";
import { getSafeSendJwtSecret } from "../services/sends/jwt-secret";
import { setSendPassword } from "../services/sends/password";
import {
  parseDateSeconds,
  parseInteger,
  sendToResponse,
  serializeSendEmails,
} from "../services/sends/presentation";
import { buildDirectUploadUrl } from "../utils/direct-upload";
import { createSendFileUploadToken } from "../utils/jwt";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";

export const createFileSend = factory.createHandlers(
  vValidator("json", CreateFileSendSchema),
  async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const secret = getSafeSendJwtSecret(c.env);
    if (!secret) return errorResponse("Server configuration error", 500);

    const body = c.req.valid("json");
    const type = parseInteger(body.type ?? body.Type);
    if (type !== 1) {
      return errorResponse("Send content is not a file", 400);
    }

    const fileLength = parseInteger(body.fileLength ?? body.FileLength);
    if (fileLength === null || fileLength < 0) {
      return errorResponse("Invalid send length", 400);
    }
    const maxFileSize = getBlobStorageMaxBytes(
      c.env,
      LIMITS.send.maxFileSizeBytes,
    );
    if (fileLength > maxFileSize) {
      return errorResponse("Send storage limit exceeded with this file", 400);
    }

    const name = String(body.name ?? body.Name ?? "").trim();
    const key = String(body.key ?? body.Key ?? "").trim();
    if (!name || !key) {
      return errorResponse("Name and Key are required", 400);
    }

    const deletionDate = parseDateSeconds(
      body.deletionDate ?? body.DeletionDate,
    );
    if (!deletionDate) {
      return errorResponse("Invalid deletionDate", 400);
    }

    const fileRaw = body.file ?? body.File;
    if (!fileRaw) {
      return errorResponse("Send data not provided", 400);
    }

    const fileId = crypto.randomUUID();
    const fileData = {
      id: fileId,
      size: fileLength,
      sizeName:
        fileRaw.sizeName || `${(fileLength / 1024 / 1024).toFixed(2)} MB`,
      fileName: fileRaw.fileName || name,
    };

    const maxAccess = parseInteger(body.maxAccessCount ?? body.MaxAccessCount);
    const expirationDate = parseDateSeconds(
      body.expirationDate ?? body.ExpirationDate,
    );
    const disabled = (body.disabled ?? body.Disabled) === true ? 1 : 0;
    const hideEmail = (body.hideEmail ?? body.HideEmail) === true ? 1 : 0;
    const notes = body.notes ?? body.Notes ?? null;
    const password = body.password ?? body.Password ?? null;
    const authType = parseInteger(body.authType ?? body.AuthType) ?? 2;

    const ts = now();
    const sendId = crypto.randomUUID();
    const send: any = {
      id: sendId,
      user_id: user.id,
      org_id: null,
      type: 1,
      name,
      notes,
      data: JSON.stringify(fileData),
      key,
      password_hash: null,
      password_salt: null,
      password_iterations: null,
      password_algorithm: null,
      auth_type: authType,
      emails: serializeSendEmails(body.emails ?? body.Emails),
      max_access_count: maxAccess,
      access_count: 0,
      disabled,
      hide_email: hideEmail,
      created_at: ts,
      updated_at: ts,
      expiration_date: expirationDate,
      deletion_date: deletionDate,
      storage_key: getSendFileObjectKey(sendId, fileId),
    };

    if (typeof password === "string" && password.length > 0) {
      await setSendPassword(send, password);
    }

    await executeBatch(c.get("dbDialect"), [
      db.insertInto("sends").values(send),
      revisionQuery(db, user.id, ts),
    ]);

    const uploadToken = await createSendFileUploadToken(
      user.id,
      send.id,
      fileId,
      secret,
    );

    return c.json({
      fileUploadType: 1,
      object: "send-fileUpload",
      url: buildDirectUploadUrl(
        c.req.raw,
        `/api/sends/${send.id}/file/${fileId}`,
        uploadToken,
      ),
      sendResponse: sendToResponse(send),
    });
  },
);

export const getSendFileUpload = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const secret = getSafeSendJwtSecret(c.env);
  if (!secret) return errorResponse("Server configuration error", 500);

  const send = c.get("send");
  const fileId = c.get("sendFileId");
  const uploadToken = await createSendFileUploadToken(
    user.id,
    send.id,
    fileId,
    secret,
  );

  return c.json({
    fileUploadType: 1,
    object: "send-fileUpload",
    url: buildDirectUploadUrl(
      c.req.raw,
      `/api/sends/${send.id}/file/${fileId}`,
      uploadToken,
    ),
    sendResponse: sendToResponse(send),
  });
});
