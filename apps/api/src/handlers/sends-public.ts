import { factory } from "../http/factory";
import {
  getBlobObject,
  getStoredSendFileObjectKey,
} from "../services/blob-store";
import * as sendsDb from "../services/db/sends";
import { getSafeSendJwtSecret } from "../services/sends/jwt-secret";
import {
  getCreatorIdentifier,
  isSendAvailable,
  parseInteger,
  parseStoredSendData,
  sendToAccessResponse,
} from "../services/sends/presentation";
import {
  createSendFileDownloadToken,
  verifySendAccessToken,
  verifySendFileDownloadToken,
} from "../utils/jwt";
import { errorResponse } from "../utils/response";

// ── Public sends router (unauthenticated APIs) ───────────────────────────────

async function sendFileExists(
  env: CloudflareBindings,
  objectKey: string,
  expectedSize: number | null,
) {
  if (expectedSize === null || expectedSize < 0) return false;
  const object = await getBlobObject(env, objectKey);
  if (!object) return false;
  await object.body?.cancel().catch(() => undefined);
  return object.size === expectedSize;
}

export const accessSendWithToken = factory.createHandlers(async (c) => {
  const db = c.get("db");
  const secret = getSafeSendJwtSecret(c.env);
  if (!secret) return errorResponse("Server configuration error", 500);

  const auth = c.req.header("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return errorResponse("Unauthorized", 401);

  const claims = await verifySendAccessToken(token, secret);
  if (!claims) return errorResponse("Unauthorized", 401);

  const send = await sendsDb.getSendById(db, claims.sub);
  if (!send || !isSendAvailable(send)) {
    return errorResponse("Send does not exist or is no longer available", 404);
  }

  if (send.type === 0) {
    if (!(await sendsDb.consumeAccess(db, send.id)))
      return errorResponse(
        "Send does not exist or is no longer available",
        404,
      );
  }

  const creatorIdentifier = await getCreatorIdentifier(db, send);
  const consumed =
    send.type === 0 ? await sendsDb.getSendById(db, send.id) : send;
  if (!consumed)
    return errorResponse("Send does not exist or is no longer available", 404);
  return c.json(sendToAccessResponse(consumed, creatorIdentifier));
});

export const accessSendFileWithToken = factory.createHandlers(async (c) => {
  const db = c.get("db");
  const secret = getSafeSendJwtSecret(c.env);
  if (!secret) return errorResponse("Server configuration error", 500);

  const auth = c.req.header("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return errorResponse("Unauthorized", 401);

  const claims = await verifySendAccessToken(token, secret);
  if (!claims) return errorResponse("Unauthorized", 401);

  const send = await sendsDb.getSendById(db, claims.sub);
  if (!send || !isSendAvailable(send) || send.type !== 1) {
    return errorResponse("Send does not exist or is no longer available", 404);
  }

  const fileId = c.req.param("fileId");
  const fileData = parseStoredSendData(send);
  if (String(fileData.id || "") !== fileId) {
    return errorResponse("Send file does not match send data.", 400);
  }

  if (
    !(await sendFileExists(
      c.env,
      getStoredSendFileObjectKey(send, fileId),
      parseInteger(fileData.size),
    ))
  )
    return errorResponse("Send file not found", 404);
  if (!(await sendsDb.consumeAccess(db, send.id)))
    return errorResponse("Send does not exist or is no longer available", 404);

  const downloadToken = await createSendFileDownloadToken(
    send.id,
    fileId,
    getStoredSendFileObjectKey(send, fileId),
    secret,
  );
  const url = new URL(c.req.url);
  const downloadUrl = `${url.origin}/api/sends/${send.id}/${fileId}?t=${downloadToken}`;

  return c.json({
    object: "send-fileDownload",
    id: fileId,
    url: downloadUrl,
  });
});

export const downloadSendFile = factory.createHandlers(async (c) => {
  const secret = getSafeSendJwtSecret(c.env);
  if (!secret) return errorResponse("Server configuration error", 500);

  const token = c.req.query("t") || c.req.query("token");
  if (!token) return errorResponse("Token required", 401);

  const claims = await verifySendFileDownloadToken(token, secret);
  if (!claims) return errorResponse("Invalid or expired token", 401);

  const sendId = c.req.param("idOrAccessId") ?? "";
  const fileId = c.req.param("fileId");

  if (claims.sendId !== sendId || claims.fileId !== fileId) {
    return errorResponse("Token mismatch", 401);
  }
  const send = await sendsDb.getSendById(c.get("db"), sendId);
  if (
    !send ||
    send.type !== 1 ||
    String(parseStoredSendData(send).id || "") !== fileId ||
    send.disabled === 1 ||
    (send.expiration_date !== null &&
      send.expiration_date <= Math.floor(Date.now() / 1000)) ||
    send.purge_token !== null ||
    getStoredSendFileObjectKey(send, fileId) !== claims.storageKey
  ) {
    return errorResponse("Send file not found", 404);
  }

  const object = await getBlobObject(c.env, claims.storageKey);
  if (!object) {
    return errorResponse("Send file not found", 404);
  }

  c.header("Content-Type", object.contentType || "application/octet-stream");
  c.header("Content-Length", String(object.size));
  c.header("Cache-Control", "private, no-cache");

  return c.body(object.body as any);
});
