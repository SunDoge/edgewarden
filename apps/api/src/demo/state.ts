import { LIMITS } from "../config";
import { DEMO_FIXTURE } from "./fixture";
import { DEMO_MARKER } from "./policy";

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
  if (await seeded(env.DB)) return;
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
    ]);
  } catch (error) {
    if (!(await seeded(env.DB)))
      throw new Error(
        "Refusing to initialize Demo on an existing vault or invalid schema",
        { cause: error },
      );
  }
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
