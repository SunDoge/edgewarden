import { bytesToBase64Url } from "../../utils/passkey";
import { verifyPassword } from "../../services/auth";
import type { Selectable } from "kysely";
import type { Users } from "../../types/db";

// Challenges are stored as SHA-256 hashes so the replay guard does not retain the bearer challenge itself.
export const MAX_TWO_FACTOR_PASSKEYS = 5;

export function recoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function verifySecret(
  user: Selectable<Users>,
  body: { masterPasswordHash: string },
): Promise<boolean> {
  const secret = body.masterPasswordHash.trim();
  return (
    !!secret && verifyPassword(secret, user.master_password_hash, user.email)
  );
}

export async function challengeHash(challenge: string): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(challenge),
      ),
    ),
  );
}
