import * as m from "$lib/paraglide/messages.js";
import type { AttachmentResponse, CipherResponse } from "@edgewarden/shared";
import {
  decryptBw,
  decryptBwFileData,
  encryptBw,
  encryptBwFileData,
} from "./crypto";

export interface AttachmentKeys {
  enc: Uint8Array;
  mac: Uint8Array;
}
export interface PreparedAttachment {
  metadata: { fileName: string; key: string; fileSize: number };
  encryptedData: Uint8Array;
}

async function cipherKeys(
  cipher: Pick<CipherResponse, "key">,
  userEnc: Uint8Array,
  userMac: Uint8Array,
): Promise<AttachmentKeys> {
  if (!cipher.key) return { enc: userEnc, mac: userMac };
  const raw = await decryptBw(cipher.key, userEnc, userMac);
  if (raw.length !== 64) throw new Error(m.ui_invalid_item_key_length());
  return { enc: raw.slice(0, 32), mac: raw.slice(32, 64) };
}

export async function prepareAttachment(
  cipher: Pick<CipherResponse, "key">,
  file: File,
  userEnc: Uint8Array,
  userMac: Uint8Array,
): Promise<PreparedAttachment> {
  if (!file.name || file.size < 1)
    throw new Error(m.ui_attachments_cannot_be_empty());
  const itemKeys = await cipherKeys(cipher, userEnc, userMac);
  const raw = crypto.getRandomValues(new Uint8Array(64));
  const keys = { enc: raw.slice(0, 32), mac: raw.slice(32, 64) };
  const encryptedData = await encryptBwFileData(
    new Uint8Array(await file.arrayBuffer()),
    keys.enc,
    keys.mac,
  );
  return {
    metadata: {
      fileName: await encryptBw(
        new TextEncoder().encode(file.name),
        keys.enc,
        keys.mac,
      ),
      key: await encryptBw(raw, itemKeys.enc, itemKeys.mac),
      fileSize: encryptedData.byteLength,
    },
    encryptedData,
  };
}

export async function decryptAttachmentMetadata(
  attachment: AttachmentResponse,
  cipher: Pick<CipherResponse, "key">,
  userEnc: Uint8Array,
  userMac: Uint8Array,
): Promise<AttachmentResponse & { _keys: AttachmentKeys }> {
  if (!attachment.key)
    throw new Error(m.ui_attachment_encryption_key_is_missing());
  const itemKeys = await cipherKeys(cipher, userEnc, userMac);
  const raw = await decryptBw(attachment.key, itemKeys.enc, itemKeys.mac);
  if (raw.length !== 64) throw new Error(m.ui_invalid_attachment_key_length());
  const keys = { enc: raw.slice(0, 32), mac: raw.slice(32, 64) };
  const fileName = new TextDecoder().decode(
    await decryptBw(attachment.fileName, keys.enc, keys.mac),
  );
  return { ...attachment, fileName, _keys: keys };
}

export async function decryptAttachmentFile(
  encrypted: Uint8Array,
  keys: AttachmentKeys,
): Promise<Uint8Array> {
  return decryptBwFileData(encrypted, keys.enc, keys.mac);
}

export function safeAttachmentFileName(name: string): string {
  const sanitized = Array.from(name, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "/" ||
      character === "\\" ||
      codePoint < 32 ||
      codePoint === 127
      ? "_"
      : character;
  }).join("");
  return sanitized.trim() || "attachment";
}
