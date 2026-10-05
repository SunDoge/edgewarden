import { decodeBase64Url, encodeBase64Url } from "../../utils/base64-url";

const SEND_PASSWORD_ALGORITHM = "pbkdf2-sha256";
const SEND_PASSWORD_ITERATIONS = 100_000;
const SEND_PASSWORD_SALT_BYTES = 64;
const SEND_PASSWORD_HASH_BYTES = 32;

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

export async function verifySendPassword(
  send: SendPasswordFields,
  password: string,
): Promise<boolean> {
  if (
    send.auth_type !== 1 ||
    !send.password_hash ||
    !send.password_salt ||
    send.password_algorithm !== SEND_PASSWORD_ALGORITHM ||
    send.password_iterations !== SEND_PASSWORD_ITERATIONS
  )
    return false;
  const salt = decodeBase64Url(send.password_salt);
  const expected = decodeBase64Url(send.password_hash);
  if (
    salt?.length !== SEND_PASSWORD_SALT_BYTES ||
    expected?.length !== SEND_PASSWORD_HASH_BYTES
  )
    return false;
  return constantTimeEqual(
    await deriveSendPasswordHash(password, salt, SEND_PASSWORD_ITERATIONS),
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
  const salt = crypto.getRandomValues(new Uint8Array(SEND_PASSWORD_SALT_BYTES));
  const hash = await deriveSendPasswordHash(
    password,
    salt,
    SEND_PASSWORD_ITERATIONS,
  );
  send.password_salt = encodeBase64Url(salt);
  send.password_hash = encodeBase64Url(hash);
  send.password_iterations = SEND_PASSWORD_ITERATIONS;
  send.password_algorithm = SEND_PASSWORD_ALGORITHM;
  send.auth_type = 1;
}
