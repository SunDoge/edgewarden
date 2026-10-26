import type { MiddlewareHandler } from "hono";
import { Kysely } from "kysely";
import type { HonoEnv } from "../env";
import { D1Dialect } from "../services/db/d1-dialect";
import type { DB } from "../types/db";

export async function createDatabase(d1: D1Database): Promise<{
  db: Kysely<DB>;
  dialect: D1Dialect;
}> {
  const dialect = new D1Dialect(d1);
  const db = new Kysely<DB>({ dialect });
  // D1 always enforces foreign keys. Issuing PRAGMA foreign_keys = ON here is
  // both ineffective and an extra remote query on every API request.
  return { db, dialect };
}

export const dbMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const { db, dialect } = await createDatabase(c.env.DB);
  c.set("db", db);
  c.set("dbDialect", dialect);
  try {
    await next();
  } finally {
    await db.destroy();
  }
};

export type { DB };
