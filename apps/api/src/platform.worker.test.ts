import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { env } from "cloudflare:workers";
import { applyD1Migrations, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { VaultRealtime } from "./durable-objects/vault-realtime";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("production Worker bindings", () => {
  it("applies the real D1 migrations", async () => {
    const schema = await env.DB.prepare("PRAGMA table_info(attachments)").all<{
      name: string;
    }>();
    expect(schema.results.some((column) => column.name === "storage_key")).toBe(
      true,
    );
  });

  it("enforces structural ownership and device lifecycle constraints", async () => {
    const suffix = crypto.randomUUID();
    const userId = `user-${suffix}`;
    const orgA = `org-a-${suffix}`;
    const orgB = `org-b-${suffix}`;
    const memberA = `member-a-${suffix}`;
    const collectionA = `collection-a-${suffix}`;
    const collectionB = `collection-b-${suffix}`;
    const cipherA = `cipher-a-${suffix}`;
    const deviceId = `device-${suffix}`;
    const timestamp = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id,email,master_password_hash,key,kdf_type,kdf_iterations,security_stamp,created_at,updated_at) VALUES (?,?,?,?,0,600000,?,?,?)",
      ).bind(
        userId,
        `${suffix}@example.test`,
        "hash",
        "key",
        "stamp",
        timestamp,
        timestamp,
      ),
      env.DB.prepare(
        "INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)",
      ).bind(orgA, "A", timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)",
      ).bind(orgB, "B", timestamp, timestamp),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO org_members (id,org_id,email,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(memberA, orgA, `${suffix}@example.test`, timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(collectionA, orgA, "A", timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(collectionB, orgB, "B", timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO ciphers (id,org_id,type,name,data,created_at,updated_at) VALUES (?,?,1,?,'{}',?,?)",
      ).bind(cipherA, orgA, "cipher", timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO devices (user_id,device_identifier,name,type,created_at,updated_at) VALUES (?,?,?,0,?,?)",
      ).bind(userId, deviceId, "device", timestamp, timestamp),
    ]);

    await expect(
      env.DB.prepare(
        "INSERT INTO collection_members (collection_id,org_member_id,org_id) VALUES (?,?,?)",
      )
        .bind(collectionB, memberA, orgB)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO cipher_collections (cipher_id,collection_id,org_id) VALUES (?,?,?)",
      )
        .bind(cipherA, collectionB, orgB)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO attachments (id,cipher_id,file_name,size,size_name,created_at) VALUES (?,?,?,?,?,?)",
      )
        .bind(`attachment-${suffix}`, cipherA, "file", -1, "-1 B", timestamp)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO invites (code,code_encrypted,email,created_by,expires_at,status,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?)",
      )
        .bind(
          `invite-${suffix}`,
          '{"v":1,"iv":"iv","data":"data"}',
          `UPPER-${suffix}@example.test`,
          userId,
          timestamp + 60,
          timestamp,
          timestamp,
        )
        .run(),
    ).rejects.toThrow();

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO refresh_tokens (token,user_id,expires_at,device_identifier) VALUES (?,?,?,?)",
      ).bind(`refresh-${suffix}`, userId, timestamp + 60, deviceId),
      env.DB.prepare(
        "INSERT INTO device_trust_tokens (token,user_id,device_identifier,expires_at) VALUES (?,?,?,?)",
      ).bind(`trust-${suffix}`, userId, deviceId, timestamp + 60),
    ]);
    await env.DB.prepare(
      "DELETE FROM devices WHERE user_id = ? AND device_identifier = ?",
    )
      .bind(userId, deviceId)
      .run();
    const remainingTokens = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ?) + (SELECT COUNT(*) FROM device_trust_tokens WHERE user_id = ?) AS count",
    )
      .bind(userId, userId)
      .first<{ count: number }>();
    expect(remainingTokens?.count).toBe(0);
  });

  it("round-trips bytes through the real R2 binding", async () => {
    const key = `platform-test/${crypto.randomUUID()}`;
    const expected = new Uint8Array([0, 1, 2, 253, 254, 255]);
    await env.ATTACHMENTS_R2.put(key, expected);
    const object = await env.ATTACHMENTS_R2.get(key);
    expect(object).not.toBeNull();
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(expected);
    await env.ATTACHMENTS_R2.delete(key);
  });

  it("instantiates the deployed Durable Object class", async () => {
    const stub = env.REALTIME.getByName(`platform-test-${crypto.randomUUID()}`);
    const isCurrentClass = await runInDurableObject(
      stub,
      (instance: VaultRealtime) => instance instanceof VaultRealtime,
    );
    expect(isCurrentClass).toBe(true);
  });
});
