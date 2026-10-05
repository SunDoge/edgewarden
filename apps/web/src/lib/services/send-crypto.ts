import {
  base64ToBytes,
  bytesToBase64,
  decryptBw,
  encryptBw,
  hkdfExpand,
  toBufferSource,
} from "./crypto";
import type {
  EncryptedOwnedSend,
  EncryptedPublicSend,
  OwnedSend,
  PublicSend,
  SendFileData,
  SendTextData,
} from "./send-types";

export interface SendKeys {
  /** The 16-byte secret carried in the Send URL fragment. */
  raw: Uint8Array;
  enc: Uint8Array;
  mac: Uint8Array;
}

export interface DecryptedSend extends Omit<OwnedSend, "file" | "text"> {
  file: SendFileData | null;
  text: SendTextData | null;
  _sendKeys: SendKeys;
  shareKey: string;
}

export interface DecryptedPublicSend extends Omit<PublicSend, "text"> {
  text: string | null;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function decryptText(value: unknown, keys: SendKeys): Promise<string> {
  if (typeof value !== "string") return "";
  return new TextDecoder().decode(await decryptBw(value, keys.enc, keys.mac));
}

export function encodeSendShareKey(raw: Uint8Array): string {
  return bytesToBase64(raw)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function deriveSendKeys(raw: Uint8Array): Promise<SendKeys> {
  if (raw.length !== 16) throw new Error("Send 密钥长度无效");
  // Match the current Bitwarden SDK: extract with HMAC-SHA256("bitwarden-send"),
  // then HKDF-expand with "send" into separate encryption and MAC keys.
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toBufferSource(new TextEncoder().encode("bitwarden-send")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prk = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacKey, toBufferSource(raw)),
  );
  const derived = await hkdfExpand(prk, "send", 64);
  return { raw, enc: derived.slice(0, 32), mac: derived.slice(32, 64) };
}

export async function decodeSendShareKey(encoded: string): Promise<SendKeys> {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Send 密钥格式无效");
  const raw = base64ToBytes(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return deriveSendKeys(raw);
}

export async function createSendKeys(): Promise<SendKeys> {
  return deriveSendKeys(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveSendPasswordHash(
  password: string,
  rawSendKey: Uint8Array,
): Promise<string> {
  if (rawSendKey.length !== 16) throw new Error("Send 密钥长度无效");
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    toBufferSource(utf8(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: toBufferSource(rawSendKey),
        iterations: 100_000,
      },
      passwordKey,
      256,
    ),
  );
  return bytesToBase64(hash);
}

export async function decryptOwnedSend(
  send: EncryptedOwnedSend,
  userEncKey: Uint8Array,
  userMacKey: Uint8Array,
): Promise<DecryptedSend> {
  const raw = await decryptBw(send.key, userEncKey, userMacKey);
  const keys = await deriveSendKeys(raw);
  const result = {
    ...send,
    _sendKeys: keys,
    shareKey: encodeSendShareKey(raw),
  } as DecryptedSend;
  result.name = await decryptText(send.name, keys);
  result.notes = send.notes ? await decryptText(send.notes, keys) : "";
  if (send.type === 0 && send.text) {
    const encryptedText = send.text.text;
    result.text = {
      ...send.text,
      text: await decryptText(encryptedText, keys),
    };
  }
  if (send.type === 1 && send.file) {
    result.file = {
      ...send.file,
      fileName: await decryptText(send.file.fileName, keys),
    };
  }
  return result;
}

export async function encryptSendMetadata(
  input: { name: string; notes?: string; text?: string },
  keys: SendKeys,
): Promise<{
  name: string;
  notes: string | null;
  text?: { text: string; hidden: false };
}> {
  const result: {
    name: string;
    notes: string | null;
    text?: { text: string; hidden: false };
  } = {
    name: await encryptBw(utf8(input.name.trim()), keys.enc, keys.mac),
    notes: input.notes?.trim()
      ? await encryptBw(utf8(input.notes.trim()), keys.enc, keys.mac)
      : null,
  };
  if (input.text !== undefined)
    result.text = {
      text: await encryptBw(utf8(input.text), keys.enc, keys.mac),
      hidden: false,
    };
  return result;
}

export async function wrapSendKey(
  keys: SendKeys,
  userEncKey: Uint8Array,
  userMacKey: Uint8Array,
): Promise<string> {
  return encryptBw(keys.raw, userEncKey, userMacKey);
}

export async function decryptPublicSend(
  send: EncryptedPublicSend,
  keys: SendKeys,
): Promise<DecryptedPublicSend> {
  const result = { ...send, text: null } as DecryptedPublicSend;
  result.name = send.name ? await decryptText(send.name, keys) : "";
  if (send.type === 0 && send.text) {
    result.text = await decryptText(
      typeof send.text === "string" ? send.text : send.text.text,
      keys,
    );
  } else if (send.type === 1 && send.file) {
    result.file = {
      ...send.file,
      fileName: await decryptText(send.file.fileName, keys),
    };
  }
  return result;
}
