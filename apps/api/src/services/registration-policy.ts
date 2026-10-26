import { safeParseJsonWithSchema } from "@edgewarden/shared";
import { type CompiledQuery, type Kysely, sql } from "kysely";
import * as v from "valibot";
import { isDemoRuntime } from "../demo/policy";
import type { DB } from "../types/db";
import type { WorkerBindings } from "../worker-bindings";
import { getConfigValue, setConfigValueQuery } from "./db/config";

export const REGISTRATION_CONFIG_KEY = "registration.policy.v1";
export const BOOTSTRAP_LOCK_KEY = "registration.bootstrap.completed";

export interface RegistrationPolicy {
  signupsAllowed: boolean;
  invitationsAllowed: boolean;
}

const RegistrationPolicyStorageSchema = v.partial(
  v.object({
    signupsAllowed: v.boolean(),
    invitationsAllowed: v.boolean(),
  }),
);

function booleanSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function defaultRegistrationPolicy(
  env: WorkerBindings,
): RegistrationPolicy {
  return {
    signupsAllowed: booleanSetting(env.SIGNUPS_ALLOWED, false),
    invitationsAllowed: booleanSetting(env.INVITATIONS_ALLOWED, true),
  };
}

export async function loadRegistrationPolicy(
  db: Kysely<DB>,
  env: WorkerBindings,
): Promise<RegistrationPolicy> {
  if (isDemoRuntime(env))
    return { signupsAllowed: false, invitationsAllowed: false };
  const value = await getConfigValue(db, REGISTRATION_CONFIG_KEY);
  return resolveRegistrationPolicy(value, env);
}

export function resolveRegistrationPolicy(
  value: string | null,
  env: WorkerBindings,
): RegistrationPolicy {
  if (isDemoRuntime(env))
    return { signupsAllowed: false, invitationsAllowed: false };
  const fallback = defaultRegistrationPolicy(env);
  if (!value) return fallback;
  const parsed = safeParseJsonWithSchema(
    value,
    RegistrationPolicyStorageSchema,
  );
  if (!parsed) return fallback;
  return {
    signupsAllowed: parsed.signupsAllowed ?? fallback.signupsAllowed,
    invitationsAllowed:
      parsed.invitationsAllowed ?? fallback.invitationsAllowed,
  };
}

export interface RegistrationState {
  userCount: number;
  bootstrapLock: string | null;
  policy: RegistrationPolicy;
}

/** Read the public registration state in one D1 query. Besides reducing
 * cross-region round trips, a single statement gives callers one snapshot. */
export async function loadRegistrationState(
  db: Kysely<DB>,
  env: WorkerBindings,
): Promise<RegistrationState> {
  const result = await sql<{
    user_count: number;
    bootstrap_lock: string | null;
    registration_policy: string | null;
  }>`
    SELECT
      (SELECT count(*) FROM users) AS user_count,
      (SELECT value FROM config WHERE key = ${BOOTSTRAP_LOCK_KEY}) AS bootstrap_lock,
      (SELECT value FROM config WHERE key = ${REGISTRATION_CONFIG_KEY}) AS registration_policy
  `.execute(db);
  const row = result.rows[0];
  return {
    userCount: Number(row?.user_count ?? 0),
    bootstrapLock: row?.bootstrap_lock ?? null,
    policy: resolveRegistrationPolicy(row?.registration_policy ?? null, env),
  };
}

export function registrationPolicyQuery(
  db: Kysely<DB>,
  policy: RegistrationPolicy,
): CompiledQuery {
  return setConfigValueQuery(
    db,
    REGISTRATION_CONFIG_KEY,
    JSON.stringify(policy),
  );
}

export function adminPasswordConfigured(env: WorkerBindings): boolean {
  return Boolean((env.BOOTSTRAP_SECRET ?? env.ADMIN_PASSWORD)?.trim());
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export async function verifyBootstrapSecret(
  env: WorkerBindings,
  candidate: string | undefined,
): Promise<boolean> {
  const configured = env.BOOTSTRAP_SECRET ?? env.ADMIN_PASSWORD;
  if (!configured?.trim() || !candidate) return false;
  const [expectedBytes, candidateBytes] = await Promise.all([
    digest(configured),
    digest(candidate),
  ]);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1)
    difference |= expectedBytes[index] ^ candidateBytes[index];
  return difference === 0;
}

export function inviteConsumptionLockKey(code: string): string {
  return `registration.invite.used:${code}`;
}
