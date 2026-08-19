import { decodeBase64Url, encodeBase64Url } from "../../utils/base64-url";

export interface SendPasswordFields {
  password_hash?: string | null;
  password_salt?: string | null;
  password_iterations?: number | null;
  password_algorithm?: string | null;
  auth_type?: number | null;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function deriveSendPasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key,
      256,
    ),
  );
}

export function verifySendPasswordHashB64(
  send: SendPasswordFields,
  passwordHashB64: string,
): boolean {
  if (!send.password_hash || !passwordHashB64) return false;
  const expected = decodeBase64Url(send.password_hash);
  const provided = decodeBase64Url(passwordHashB64);
  return !!expected && !!provided && constantTimeEqual(expected, provided);
}

export async function verifySendPassword(
  send: SendPasswordFields,
  password: string,
): Promise<boolean> {
  if (!send.password_hash) return false;
  if (!send.password_salt || !send.password_iterations) {
    return verifySendPasswordHashB64(send, password);
  }
  const salt = decodeBase64Url(send.password_salt);
  const expected = decodeBase64Url(send.password_hash);
  if (!salt || !expected) return false;
  return constantTimeEqual(
    await deriveSendPasswordHash(password, salt, send.password_iterations),
    expected,
  );
}

export async function setSendPassword(
  send: SendPasswordFields,
  password: string | null,
): Promise<void> {
  if (!password) {
    send.password_hash = null;
    send.password_salt = null;
    send.password_iterations = null;
    send.password_algorithm = null;
    if (send.auth_type === 1) send.auth_type = 2;
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(64));
  const hash = await deriveSendPasswordHash(password, salt, 100000);
  send.password_salt = encodeBase64Url(salt);
  send.password_hash = encodeBase64Url(hash);
  send.password_iterations = 100000;
  send.password_algorithm = "pbkdf2-sha256";
  send.auth_type = 1;
}
