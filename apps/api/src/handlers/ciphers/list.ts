import { factory } from "../../http/factory";
import { cipherToResponse } from "../../services/ciphers/presentation";
import * as attachmentsDb from "../../services/db/attachments";
import * as ciphersDb from "../../services/db/ciphers";

// List responses batch attachment reads to avoid one D1 query per cipher.
// GET /api/ciphers
export const listCiphers = factory.createHandlers(async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  const ciphers = await ciphersDb.getCiphersByUserId(db, user.id);
  const attachments = await attachmentsDb.listByCipherIds(
    db,
    ciphers.map((cipher) => cipher.id),
  );
  const attachmentsByCipher = Map.groupBy(
    attachments,
    (attachment) => attachment.cipher_id,
  );
  return c.json({
    data: ciphers.map((cipher) =>
      cipherToResponse(cipher, attachmentsByCipher.get(cipher.id)),
    ),
    object: "list",
    continuationToken: null,
  });
});
