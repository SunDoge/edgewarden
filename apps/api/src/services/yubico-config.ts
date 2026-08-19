import { parseJsonWithSchema } from "@edgewarden/shared";
import type { CompiledQuery, Kysely } from "kysely";
import * as v from "valibot";
import type { DB } from "../types/db";
import type { YubicoCredentials } from "../utils/yubico";
import type { WorkerBindings } from "../worker-bindings";

export const YUBICO_CONFIG_KEY = "security.yubico.credentials.v1";

const EncryptedYubicoConfigSchema = v.object({
  iv: v.pipe(v.string(), v.minLength(1)),
  data: v.pipe(v.string(), v.minLength(1)),
});
const YubicoCredentialsSchema = v.object({
  clientId: v.pipe(v.string(), v.minLength(1)),
  secretKey: v.pipe(v.string(), v.minLength(1)),
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

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`edgewarden:yubico-config:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function prepareYubicoCredentialsUpdate(
  db: Kysely<DB>,
  dataEncryptionSecret: string,
  credentials: YubicoCredentials,
): Promise<{ query: CompiledQuery; value: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(dataEncryptionSecret),
    plaintext,
  );
  const value = JSON.stringify({
    iv: bytesBase64(iv),
    data: bytesBase64(new Uint8Array(ciphertext)),
  });
  const query = db
    .insertInto("config")
    .values({ key: YUBICO_CONFIG_KEY, value })
    .onConflict((conflict) => conflict.column("key").doUpdateSet({ value }))
    .compile();
  return { query, value };
}

export async function loadYubicoCredentials(
  db: Kysely<DB>,
  env: WorkerBindings,
): Promise<YubicoCredentials | null> {
  const envClientId = String(env.YUBICO_CLIENT_ID ?? "").trim();
  const envSecret = String(env.YUBICO_SECRET_KEY ?? "").trim();
  if (envClientId && envSecret)
    return { clientId: envClientId, secretKey: envSecret };
  const row = await db
    .selectFrom("config")
    .select("value")
    .where("key", "=", YUBICO_CONFIG_KEY)
    .executeTakeFirst();
  if (!row) return null;
  try {
    const encrypted = parseJsonWithSchema(
      row.value,
      EncryptedYubicoConfigSchema,
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64Bytes(encrypted.iv) },
      await encryptionKey(env.DATA_ENCRYPTION_SECRET),
      base64Bytes(encrypted.data),
    );
    const parsed = parseJsonWithSchema(
      new TextDecoder().decode(plaintext),
      YubicoCredentialsSchema,
    );
    return parsed;
  } catch {
    return null;
  }
}
