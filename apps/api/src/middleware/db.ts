import { D1Dialect } from "@sundoge/kysely-d1";
import type { MiddlewareHandler } from "hono";
import { Kysely, sql } from "kysely";
import type { HonoEnv } from "../env";
import type { DB } from "../types/db";

export async function createDatabase(d1: D1Database): Promise<{
	db: Kysely<DB>;
	dialect: D1Dialect;
}> {
	const dialect = new D1Dialect({ database: d1 });
	const db = new Kysely<DB>({ dialect });
	// D1/SQLite does not enforce FK constraints by default — enable per connection
	await sql`PRAGMA foreign_keys = ON`.execute(db);
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
