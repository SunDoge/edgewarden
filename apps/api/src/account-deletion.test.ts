import { afterAll, beforeAll, expect, test } from "vitest";
import { createDatabase } from "./middleware/db";
import { generateAccessToken } from "./services/auth";
import {
  createApiTestHarness,
  type ApiTestHarness,
} from "./test-support/api-harness";

const secret = "account-deletion-regression-secret-at-least-32-characters";
const hash = "account-deletion-client-hash";
let harness: ApiTestHarness;

beforeAll(async () => {
  harness = await createApiTestHarness({
    adminPassword: "account-deletion-bootstrap-password",
    jwtSecret: secret,
    dataEncryptionSecret:
      "account-deletion-encryption-secret-at-least-32-characters",
  });
});
afterAll(async () => harness?.dispose());

async function fixture() {
  const { db } = await createDatabase(harness.database);
  const timestamp = Math.floor(Date.now() / 1000);
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const email = `${memberId}@example.test`;
  await db
    .insertInto("users")
    .values([
      {
        id: ownerId,
        email: `${ownerId}@example.test`,
        role: "admin",
        master_password_hash: hash,
        key: "owner-key",
        kdf_type: 0,
        kdf_iterations: 600000,
        security_stamp: crypto.randomUUID(),
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: memberId,
        email,
        role: "user",
        master_password_hash: hash,
        key: "member-key",
        kdf_type: 0,
        kdf_iterations: 600000,
        security_stamp: crypto.randomUUID(),
        created_at: timestamp,
        updated_at: timestamp,
      },
    ])
    .execute();
  const orgId = crypto.randomUUID();
  await db
    .insertInto("organizations")
    .values({
      id: orgId,
      name: "Main account organization",
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();
  await db
    .insertInto("org_members")
    .values([
      {
        id: crypto.randomUUID(),
        org_id: orgId,
        user_id: ownerId,
        email: `${ownerId}@example.test`,
        role: "owner",
        status: "confirmed",
        key: "owner-org-key",
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: crypto.randomUUID(),
        org_id: orgId,
        user_id: memberId,
        email,
        role: "member",
        status: "confirmed",
        key: "member-org-key",
        created_at: timestamp,
        updated_at: timestamp,
      },
    ])
    .execute();
  const orgCipherId = crypto.randomUUID();
  await db
    .insertInto("ciphers")
    .values({
      id: orgCipherId,
      org_id: orgId,
      type: 1,
      name: "shared-encrypted-name",
      data: "{}",
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();
  const owner = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", ownerId)
    .executeTakeFirstOrThrow();
  const token = await generateAccessToken(owner, null, secret);
  const admin = harness.authenticated(token);
  const remove = () =>
    admin.json(
      `/api/admin/users/${memberId}`,
      { masterPasswordHash: hash },
      { method: "DELETE" },
    );
  const member = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", memberId)
    .executeTakeFirstOrThrow();
  const memberToken = await generateAccessToken(member, null, secret);
  return {
    db,
    ownerId,
    memberId,
    memberToken,
    email,
    orgId,
    orgCipherId,
    admin,
    remove,
  };
}

test("deleting a regular member preserves the main account's organization and hides the user", async () => {
  const f = await fixture();
  expect((await f.remove()).status).toBe(204);
  expect(
    await f.db
      .selectFrom("organizations")
      .select("deletion_requested_at")
      .where("id", "=", f.orgId)
      .executeTakeFirstOrThrow(),
  ).toEqual({ deletion_requested_at: null });
  expect(
    await f.db
      .selectFrom("ciphers")
      .select("deleted_at")
      .where("id", "=", f.orgCipherId)
      .executeTakeFirstOrThrow(),
  ).toEqual({ deleted_at: null });
  expect(
    await f.db
      .selectFrom("org_members")
      .select("id")
      .where("user_id", "=", f.memberId)
      .execute(),
  ).toEqual([]);
  const users = await (await f.admin.request("/api/admin/users")).json<{
    data: { id: string }[];
  }>();
  expect(users.data.some((user) => user.id === f.memberId)).toBe(false);
  const retained = await f.db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", f.memberId)
    .executeTakeFirstOrThrow();
  expect(retained.deleted_email).toBe(f.email);
  expect(retained.email).not.toBe(f.email);
  expect(retained.master_password_salt).toBe(f.email);
  expect(retained.key).toBe("member-key");
  expect(
    (
      await harness
        .authenticated(f.memberToken)
        .request("/api/accounts/profile")
    ).status,
  ).toBe(401);
});

test("retrying deletion does not falsely report organization ownership", async () => {
  const f = await fixture();
  expect((await f.remove()).status).toBe(204);
  const retry = await f.remove();
  expect(retry.status, await retry.text()).toBe(204);
  expect(
    await f.db
      .selectFrom("audit_logs")
      .select("id")
      .where("action", "=", "admin.user.delete")
      .where("target_id", "=", f.memberId)
      .execute(),
  ).toHaveLength(1);
});

test("a deleted member's email can register a new account without inheriting memberships", async () => {
  const f = await fixture();
  expect((await f.remove()).status).toBe(204);
  const registration = await harness.json("/api/edgewarden/accounts/register", {
    email: f.email,
    name: "Replacement",
    masterPasswordHash: "new-client-hash",
    key: "new-encrypted-key",
    kdf: 0,
    kdfIterations: 600000,
  });
  expect(registration.status, await registration.text()).toBe(204);
  const replacement = await f.db
    .selectFrom("users")
    .selectAll()
    .where("email", "=", f.email)
    .executeTakeFirstOrThrow();
  expect(replacement.id).not.toBe(f.memberId);
  expect(
    await f.db
      .selectFrom("org_members")
      .select("id")
      .where("user_id", "=", replacement.id)
      .execute(),
  ).toEqual([]);
  expect(replacement.key).toBe("new-encrypted-key");
});

test("concurrent deletion is idempotent and records a single deletion event", async () => {
  const f = await fixture();
  const responses = await Promise.all([f.remove(), f.remove()]);
  expect(responses.map((response) => response.status)).toEqual([204, 204]);
  expect(
    await f.db
      .selectFrom("audit_logs")
      .select("id")
      .where("action", "=", "admin.user.delete")
      .where("target_id", "=", f.memberId)
      .execute(),
  ).toHaveLength(1);
});

test("a retry reconciles a tombstone written by the old Worker during rollout", async () => {
  const f = await fixture();
  await f.db
    .updateTable("users")
    .set({ status: "banned", deletion_requested_at: 1 })
    .where("id", "=", f.memberId)
    .execute();
  await f.db
    .deleteFrom("org_members")
    .where("user_id", "=", f.memberId)
    .execute();
  expect((await f.remove()).status).toBe(204);
  const archived = await f.db
    .selectFrom("users")
    .select(["email", "deleted_email", "master_password_salt"])
    .where("id", "=", f.memberId)
    .executeTakeFirstOrThrow();
  expect(archived.email).not.toBe(f.email);
  expect(archived.deleted_email).toBe(f.email);
  expect(archived.master_password_salt).toBe(f.email);
  expect(
    await f.db
      .selectFrom("audit_logs")
      .select("id")
      .where("action", "=", "admin.user.delete")
      .where("target_id", "=", f.memberId)
      .execute(),
  ).toHaveLength(0);
});

test("an actual organization owner is still protected from administrative deletion", async () => {
  const f = await fixture();
  await f.db
    .updateTable("users")
    .set({ role: "admin" })
    .where("id", "=", f.memberId)
    .execute();
  const response = await harness
    .authenticated(f.memberToken)
    .json(
      `/api/admin/users/${f.ownerId}`,
      { masterPasswordHash: hash },
      { method: "DELETE" },
    );
  expect(response.status).toBe(409);
  const owner = await f.db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", f.ownerId)
    .executeTakeFirstOrThrow();
  expect(owner.deletion_requested_at).toBeNull();
  expect(owner.deleted_email).toBeNull();
  expect(owner.email).toBe(`${f.ownerId}@example.test`);
  expect(
    await f.db
      .selectFrom("org_members")
      .select("id")
      .where("org_id", "=", f.orgId)
      .execute(),
  ).toHaveLength(2);
});

test("a failed deletion audit rolls back email release and member removal", async () => {
  const f = await fixture();
  await harness.database
    .prepare(
      "CREATE TRIGGER reject_account_deletion_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'admin.user.delete' BEGIN SELECT RAISE(ABORT, 'test deletion audit failure'); END",
    )
    .run();
  try {
    expect((await f.remove()).status).toBe(500);
    const retained = await f.db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", f.memberId)
      .executeTakeFirstOrThrow();
    expect(retained.email).toBe(f.email);
    expect(retained.deletion_requested_at).toBeNull();
    expect(retained.deleted_email).toBeNull();
    expect(
      await f.db
        .selectFrom("org_members")
        .select("id")
        .where("user_id", "=", f.memberId)
        .execute(),
    ).toHaveLength(1);
  } finally {
    await harness.database
      .prepare("DROP TRIGGER reject_account_deletion_audit")
      .run();
  }
});
