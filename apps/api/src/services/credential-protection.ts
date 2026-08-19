import { parseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";

const ENVELOPE_VERSION = 1;

type CredentialPurpose =
  | "api-key"
  | "totp-secret"
  | "totp-recovery"
  | "invite-code"
  | "auth-request-access-code";

interface EncryptedEnvelope {
  v: typeof ENVELOPE_VERSION;
  iv: string;
  data: string;
}

const EncryptedEnvelopeSchema = v.object({
  v: v.literal(ENVELOPE_VERSION),
  iv: v.pipe(v.string(), v.minLength(1)),
  data: v.pipe(v.string(), v.minLength(1)),
});

function bytesBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(
  secret: string,
  purpose: CredentialPurpose,
): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `edgewarden:credential-protection:v1:${purpose}:${secret}`,
    ),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptCredential(
  value: string,
  secret: string,
  purpose: CredentialPurpose,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret, purpose),
    new TextEncoder().encode(value),
  );
  const envelope: EncryptedEnvelope = {
    v: ENVELOPE_VERSION,
    iv: bytesBase64(iv),
    data: bytesBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope);
}

export async function decryptCredential(
  value: string,
  secret: string,
  purpose: CredentialPurpose,
): Promise<string> {
  let envelope: EncryptedEnvelope;
  try {
    envelope = parseJsonWithSchema(value, EncryptedEnvelopeSchema);
  } catch {
    throw new Error("Unsupported encrypted credential envelope");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Bytes(envelope.iv) },
    await encryptionKey(secret, purpose),
    base64Bytes(envelope.data),
  );
  return new TextDecoder().decode(plaintext);
}

export async function hashCredential(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeCredentialEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
