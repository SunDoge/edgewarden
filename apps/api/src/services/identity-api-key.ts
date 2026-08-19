import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import { generateAccessToken } from "./auth";
import {
  constantTimeCredentialEqual,
  hashCredential,
} from "./credential-protection";
import * as usersDb from "./db/users";

export type ApiKeyAuthenticationResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "invalid_client_id" | "invalid_credentials" };

export async function authenticateApiKey(args: {
  db: Kysely<DB>;
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
}): Promise<ApiKeyAuthenticationResult> {
  const match = args.clientId.trim().match(/^user\.(.+)$/);
  if (!match) return { ok: false, reason: "invalid_client_id" };

  const user = await usersDb.getUserById(args.db, match[1]);
  const suppliedHash = args.clientSecret
    ? await hashCredential(args.clientSecret.trim())
    : "";
  if (
    user?.status !== "active" ||
    !user.api_key_hash ||
    !constantTimeCredentialEqual(user.api_key_hash, suppliedHash)
  ) {
    return { ok: false, reason: "invalid_credentials" };
  }
  return {
    ok: true,
    accessToken: await generateAccessToken(user, null, args.jwtSecret),
  };
}
