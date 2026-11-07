import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("releases legacy deleted-account emails without touching active users or their organizations", () => {
  const db = new Database(":memory:");
  const migrations = join(import.meta.dirname, "../migrations");
  try {
    for (const file of readdirSync(migrations)
      .filter((file) => /^000[123]_/.test(file))
      .sort()) {
      db.exec(readFileSync(join(migrations, file), "utf8"));
    }
    const insert = db.prepare(
      "INSERT INTO users (id,email,master_password_hash,key,kdf_type,kdf_iterations,security_stamp,status,deletion_requested_at,created_at,updated_at) VALUES (?,?,?,'retained-key',0,600000,'stamp',?,?,1,1)",
    );
    insert.run("active", "owner@example.test", "hash", "active", null);
    insert.run("deleted", "member@example.test", "old-hash", "banned", 1);
    db.exec(
      "INSERT INTO organizations (id,name,created_at,updated_at) VALUES ('org','Main account organization',1,1)",
    );
    db.exec(
      "INSERT INTO org_members (id,org_id,user_id,email,role,status,created_at,updated_at) VALUES ('membership','org','active','owner@example.test','owner','confirmed',1,1)",
    );
    db.exec(
      readFileSync(join(migrations, "0004_deleted_account_email.sql"), "utf8"),
    );
    expect(
      db
        .prepare(
          "SELECT email,deleted_email,deletion_requested_at FROM users WHERE id='active'",
        )
        .get(),
    ).toEqual({
      email: "owner@example.test",
      deleted_email: null,
      deletion_requested_at: null,
    });
    const archived = db
      .prepare(
        "SELECT email,deleted_email,master_password_salt,key FROM users WHERE id='deleted'",
      )
      .get() as {
      email: string;
      deleted_email: string;
      master_password_salt: string;
      key: string;
    };
    expect(archived.email).not.toBe("member@example.test");
    expect(archived.deleted_email).toBe("member@example.test");
    expect(archived.master_password_salt).toBe("member@example.test");
    expect(archived.key).toBe("retained-key");
    insert.run(
      "replacement",
      "member@example.test",
      "new-hash",
      "active",
      null,
    );
    expect(
      db.prepare("SELECT id FROM org_members WHERE user_id='active'").all(),
    ).toHaveLength(1);
  } finally {
    db.close();
  }
});
