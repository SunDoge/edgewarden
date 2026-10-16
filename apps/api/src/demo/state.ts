import { LIMITS } from "../config";
import { DEMO_FIXTURE } from "./fixture";
import { DEMO_MARKER, DEMO_EMAIL, DEMO_USER_ID } from "./policy";
import {
  DEMO_ENGLISH_MARKER,
  DEMO_ENGLISH_PATCHES,
  DEMO_ENGLISH_REVISION,
} from "./english-content";

export type DemoBindings = CloudflareBindings & { DEMO_MODE?: string };
export function requireDemoDeployment(env: DemoBindings): void {
  if (env.DEMO_MODE !== "readonly")
    throw new Error("Readonly Demo mode is required");
}
async function seeded(db: D1Database): Promise<boolean> {
  return Boolean(
    await db
      .prepare("SELECT value FROM config WHERE key = ? AND value = 'ready'")
      .bind(DEMO_MARKER)
      .first(),
  );
}
/** One atomic seed, never adopt or erase an existing vault. SQL identifiers are
 * from the checked-in fixture, never from a request. Concurrent initializers
 * either commit the entire fixture or observe the winner's marker. */
export async function initializeDemo(env: DemoBindings): Promise<void> {
  requireDemoDeployment(env);
  if (await seeded(env.DB)) {
    await updateDemoContent(env.DB);
    return;
  }
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO config (key,value) VALUES (?, CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'ready' ELSE NULL END)",
      ).bind(DEMO_MARKER),
      ...DEMO_FIXTURE.map(({ table, row }) =>
        env.DB.prepare(
          `INSERT INTO "${table}" (${Object.keys(row)
            .map((key) => `"${key}"`)
            .join(",")}) VALUES (${Object.keys(row)
            .map(() => "?")
            .join(",")})`,
        ).bind(...Object.values(row)),
      ),
      env.DB.prepare("INSERT INTO config (key,value) VALUES (?, 'ready')").bind(
        DEMO_ENGLISH_MARKER,
      ),
    ]);
  } catch (error) {
    if (!(await seeded(env.DB)))
      throw new Error(
        "Refusing to initialize Demo on an existing vault or invalid schema",
        { cause: error },
      );
  }
  await updateDemoContent(env.DB);
}

/** Only upgrade the exact public sample, retaining keys, IDs and sessions.
 * Validate inside the same transaction as the updates: a mismatched sample
 * violates config.value's NOT NULL constraint and rolls back the entire batch.
 * Allow both versions so concurrent initializers are harmless. Identifiers
 * below come exclusively from the checked-in translation manifest. */
async function updateDemoContent(db: D1Database): Promise<void> {
  if (
    await db
      .prepare("SELECT 1 FROM config WHERE key = ? AND value = 'ready'")
      .bind(DEMO_ENGLISH_MARKER)
      .first()
  )
    return;
  const user = DEMO_FIXTURE.find(({ table }) => table === "users")!.row;
  const conditions = [
    "(SELECT count(*) FROM users) = 1",
    "EXISTS (SELECT 1 FROM users WHERE id = ? AND email = ? AND key = ?)",
  ];
  const values: (string | number | null)[] = [
    DEMO_USER_ID,
    DEMO_EMAIL,
    user.key,
  ];
  for (const patch of DEMO_ENGLISH_PATCHES) {
    const fields = Object.keys(patch.before);
    const match = fields.map((field) => `"${field}" = ?`).join(" AND ");
    conditions.push(
      `EXISTS (SELECT 1 FROM "${patch.table}" WHERE id = ? AND ((${match}) OR (${match})))`,
    );
    values.push(
      patch.id,
      ...Object.values(patch.before),
      ...Object.values(patch.after),
    );
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO config (key,value) VALUES (?, CASE WHEN ${conditions.join(" AND ")} THEN 'ready' ELSE NULL END) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(DEMO_ENGLISH_MARKER, ...values),
    ...DEMO_ENGLISH_PATCHES.map((patch) =>
      db
        .prepare(
          `UPDATE "${patch.table}" SET ${Object.keys(patch.after)
            .map((field) => `"${field}" = ?`)
            .join(",")}, updated_at = max(updated_at, ?) WHERE id = ?`,
        )
        .bind(...Object.values(patch.after), DEMO_ENGLISH_REVISION, patch.id),
    ),
    db
      .prepare(
        "UPDATE user_revisions SET revision_date = max(revision_date, ?) WHERE user_id = ?",
      )
      .bind(DEMO_ENGLISH_REVISION, DEMO_USER_ID),
  ]);
}
/** Only ephemeral authentication metadata expires; never reset vault data. */
export async function cleanupDemo(
  env: DemoBindings,
  time = Date.now(),
): Promise<void> {
  requireDemoDeployment(env);
  if (!(await seeded(env.DB))) return;
  const cutoff = Math.floor(time / 1000) - 86400;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM refresh_tokens WHERE expires_at <= ?").bind(
      cutoff + LIMITS.auth.refreshTokenTtlSeconds,
    ),
    env.DB.prepare(
      "DELETE FROM devices WHERE coalesce(last_seen_at,created_at) < ? AND NOT EXISTS (SELECT 1 FROM refresh_tokens WHERE refresh_tokens.user_id = devices.user_id AND refresh_tokens.device_identifier = devices.device_identifier)",
    ).bind(cutoff),
    env.DB.prepare(
      "DELETE FROM audit_logs WHERE is_tombstone = 0 AND created_at < ?",
    ).bind(cutoff),
    env.DB.prepare("DELETE FROM login_attempts WHERE updated_at < ?").bind(
      cutoff,
    ),
  ]);
}
