import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  createApiTestHarness,
  expectJson,
  type ApiTestHarness,
} from "./test-support/api-harness";
import { createBackupRestoreFixture } from "./test-support/backup-restore-fixture";
import * as pushRelay from "./services/push-relay";

type Account = Awaited<ReturnType<typeof createBackupRestoreFixture>>;
type Cipher = {
  id: string;
  edit: boolean;
  viewPassword: boolean;
  collectionIds: string[];
  attachments: { id: string; key: string; fileName: string }[];
};
let h: ApiTestHarness;
let owner: Account;
let manager: Account;
let target: Account;
let org: string;
let allowed: string;
let hidden: string;
let managerMember: string;
let shared: string;
const email = (account: Account) =>
  `backup-restore-${account.userId}@example.com`;
const run = (statement: string, ...args: (string | number)[]) =>
  h.database
    .prepare(statement)
    .bind(...args)
    .run();
const memberPath = () => `/api/edgewarden/organizations/${org}/members`;
const itemBody = () => ({
  type: 1,
  name: "encrypted-edited-name",
  organizationId: org,
});
const inviteBody = () => ({
  email: email(target),
  role: "member",
  accessAll: true,
  key: "encrypted-org-key",
});
beforeAll(async () => {
  h = await createApiTestHarness({
    adminPassword: "sharing-bootstrap",
    jwtSecret: "sharing-secret-at-least-thirty-two-characters",
    dataEncryptionSecret:
      "sharing-encryption-secret-at-least-thirty-two-characters",
  });
});
beforeEach(async () => {
  const fixture = () =>
    createBackupRestoreFixture({
      database: h.database,
      request: h.request,
      masterPasswordHash: "sharing-password-hash",
    });
  owner = await fixture();
  manager = await fixture();
  target = await fixture();
  [org, allowed, hidden, managerMember, shared] = Array.from(
    { length: 5 },
    () => crypto.randomUUID(),
  );
  await run(
    "UPDATE users SET public_key = 'test-public-key', private_key = 'test-private-key' WHERE id IN (?,?,?)",
    owner.userId,
    manager.userId,
    target.userId,
  );
  await run(
    "INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?, 'test-org', 1, 1)",
    org,
  );
  for (const [user, role, all, id] of [
    [owner, "owner", 1, crypto.randomUUID()],
    [manager, "manager", 0, managerMember],
  ] as const) {
    await run(
      "INSERT INTO org_members (id,org_id,user_id,email,key,role,status,access_all,created_at,updated_at) VALUES (?,?,?,?,'test-key',?,'confirmed',?,1,1)",
      id,
      org,
      user.userId,
      email(user),
      role,
      all,
    );
  }
  for (const id of [allowed, hidden])
    await run(
      "INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,'encrypted-name',1,1)",
      id,
      org,
    );
  await run(
    "INSERT INTO collection_members (collection_id,org_member_id,org_id,read_only,hide_passwords) VALUES (?,?,?,1,1)",
    allowed,
    managerMember,
    org,
  );
  await run(
    "INSERT INTO ciphers (id,org_id,type,name,data,created_at,updated_at) VALUES (?,?,1,'encrypted-name','{}',1,1)",
    shared,
    org,
  );
  await run(
    "INSERT INTO cipher_collections (cipher_id,collection_id,org_id) VALUES (?,?,?)",
    shared,
    allowed,
    org,
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await h?.dispose();
});

test.each([0, 1])(
  "manager with accessAll=%i cannot administer members",
  async (accessAll) => {
    await run(
      "UPDATE org_members SET access_all=? WHERE id=?",
      accessAll,
      managerMember,
    );
    const client = h.authenticated(manager.accessToken);
    const publish = vi.spyOn(h.bindings.REALTIME, "getByName");
    for (const response of [
      await client.request(memberPath()),
      await client.request(
        `/api/edgewarden/organizations/${org}/invitee?email=${encodeURIComponent(email(target))}`,
      ),
      await client.json(memberPath(), inviteBody()),
      await client.json(
        `${memberPath()}/${managerMember}`,
        { role: "member", accessAll: true },
        { method: "PUT" },
      ),
      await client.request(`${memberPath()}/${managerMember}`, {
        method: "DELETE",
      }),
    ])
      expect(response.status).toBe(403);
    expect(publish).not.toHaveBeenCalled();
    expect(
      (
        await h
          .authenticated(target.accessToken)
          .request(`/api/organizations/${org}/collections`)
      ).status,
    ).toBe(404);
  },
);

test.each(["manager", "member", "admin"])(
  "restricted %s observes read-only grants on every item write path",
  async (role) => {
    await run("UPDATE org_members SET role=? WHERE id=?", role, managerMember);
    const client = h.authenticated(manager.accessToken);
    const sync = await expectJson<{ ciphers: Cipher[] }>(
      await client.request("/api/sync"),
    );
    expect(sync.ciphers.find((c) => c.id === shared)).toMatchObject({
      edit: false,
      viewPassword: false,
    });
    expect(
      await expectJson(await client.request(`/api/ciphers/${shared}`)),
    ).toMatchObject({ edit: false, viewPassword: false });
    for (const response of [
      await client.json(`/api/ciphers/${shared}`, itemBody(), {
        method: "PUT",
      }),
      await client.request(`/api/ciphers/${shared}`, { method: "DELETE" }),
      await client.json(
        `/api/ciphers/${shared}/collections`,
        { collectionIds: [hidden] },
        { method: "PUT" },
      ),
      await client.json("/api/ciphers", {
        ...itemBody(),
        collectionIds: [allowed],
      }),
      await client.json(
        `/api/ciphers/${manager.cipherId}/share`,
        { cipher: itemBody(), collectionIds: [allowed] },
        { method: "PUT" },
      ),
      await client.json("/api/ciphers/bulk-collections", {
        organizationId: org,
        cipherIds: [shared],
        collectionIds: [hidden],
        removeCollections: false,
      }),
    ])
      expect(response.status).toBe(403);
    expect(
      (await client.request(`/api/ciphers/${target.cipherId}`)).status,
    ).toBe(404);
  },
);

test("restricted managers cannot administer even assigned collection structure", async () => {
  const client = h.authenticated(manager.accessToken);
  expect(
    (
      await client.json(`/api/organizations/${org}/collections`, {
        name: "new-collection",
      })
    ).status,
  ).toBe(403);
  for (const id of [allowed, hidden]) {
    expect(
      (
        await client.json(
          `/api/organizations/${org}/collections/${id}`,
          { name: "renamed" },
          { method: "PUT" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await client.request(`/api/organizations/${org}/collections/${id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
  }
});

test("unrestricted managers can manage collections and write items", async () => {
  await run("UPDATE org_members SET access_all=1 WHERE id=?", managerMember);
  const client = h.authenticated(manager.accessToken);
  expect(
    (
      await client.json(`/api/organizations/${org}/collections`, {
        name: "new-collection",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await client.json(
        `/api/organizations/${org}/collections/${hidden}`,
        { name: "renamed" },
        { method: "PUT" },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await client.request(`/api/organizations/${org}/collections/${hidden}`, {
        method: "DELETE",
      })
    ).status,
  ).toBe(204);
  expect(
    (await client.json(`/api/ciphers/${shared}`, itemBody(), { method: "PUT" }))
      .status,
  ).toBe(200);
});

test("hidden-password grants survive item mutation responses", async () => {
  await run("UPDATE org_members SET role='member' WHERE id=?", managerMember);
  await run(
    "UPDATE collection_members SET read_only=0 WHERE org_member_id=?",
    managerMember,
  );
  const client = h.authenticated(manager.accessToken);
  const check = async (response: Response) =>
    expect(await expectJson<Cipher>(response)).toMatchObject({
      edit: true,
      viewPassword: false,
    });
  await check(
    await client.json(`/api/ciphers/${shared}`, itemBody(), { method: "PUT" }),
  );
  await check(
    await client.json("/api/ciphers", {
      ...itemBody(),
      collectionIds: [allowed],
    }),
  );
  await check(
    await client.json(
      `/api/ciphers/${shared}/partial`,
      { folderId: null, favorite: true },
      { method: "PUT" },
    ),
  );
  for (const operation of ["archive", "unarchive"])
    await check(
      await client.request(`/api/ciphers/${shared}/${operation}`, {
        method: "PUT",
      }),
    );
  expect(
    (await client.request(`/api/ciphers/${shared}/delete`, { method: "PUT" }))
      .status,
  ).toBe(200);
  await check(
    await client.request(`/api/ciphers/${shared}/restore`, { method: "PUT" }),
  );
  await check(
    await client.json(
      `/api/ciphers/${manager.cipherId}/share`,
      { cipher: itemBody(), collectionIds: [allowed] },
      { method: "PUT" },
    ),
  );
});

async function attachment(
  cipherId = owner.cipherId,
  key = "old-personal-key",
  fileName = "old-personal-name",
) {
  const id = crypto.randomUUID();
  await run(
    "INSERT INTO attachments (id,cipher_id,file_name,size,size_name,key,created_at) VALUES (?,?,?,1,'1 B',?,1)",
    id,
    cipherId,
    fileName,
    key,
  );
  return id;
}
const metadata = { fileName: "org-encrypted-filename", key: "org-wrapped-key" };
async function share(bulk: boolean, cipher: Record<string, unknown>) {
  const client = h.authenticated(owner.accessToken);
  return bulk
    ? client.json(
        "/api/ciphers/share",
        {
          ciphers: [{ ...cipher, id: owner.cipherId }],
          collectionIds: [allowed],
        },
        { method: "PUT" },
      )
    : client.json(
        `/api/ciphers/${owner.cipherId}/share`,
        { cipher, collectionIds: [allowed] },
        { method: "PUT" },
      );
}

test.each([false, true])(
  "pending attachment uploads block sharing (bulk=%s)",
  async (bulk) => {
    await run(
      "INSERT INTO attachment_uploads (id,cipher_id,file_name,size,key,created_at,expires_at) VALUES (?,?,'upload-name',1,'upload-key',1,9999999999999)",
      crypto.randomUUID(),
      owner.cipherId,
    );
    expect((await share(bulk, itemBody())).status).toBe(409);
    expect(
      await h.database
        .prepare("SELECT org_id FROM ciphers WHERE id=?")
        .bind(owner.cipherId)
        .first(),
    ).toMatchObject({ org_id: null });
  },
);

test.each([false, true])(
  "sharing (bulk=%s) persists attachment metadata without echoing request-only fields",
  async (bulk) => {
    const id = await attachment();
    expect(
      (await share(bulk, { ...itemBody(), attachments2: { [id]: metadata } }))
        .status,
    ).toBe(200);
    const saved = await expectJson<Cipher>(
      await h
        .authenticated(owner.accessToken)
        .request(`/api/ciphers/${owner.cipherId}`),
    );
    expect(saved.attachments).toContainEqual(
      expect.objectContaining({ id, ...metadata }),
    );
    expect(saved).not.toHaveProperty("attachments2");
  },
);

test.each([false, true])(
  "sharing (bulk=%s) refuses missing attachment rewraps and foreign attachment IDs",
  async (bulk) => {
    const id = await attachment();
    const foreign = await attachment(target.cipherId);
    for (const attachments2 of [
      undefined,
      { [foreign]: metadata },
      { [id]: metadata, [foreign]: metadata },
    ]) {
      expect((await share(bulk, { ...itemBody(), attachments2 })).status).toBe(
        400,
      );
      expect(
        await h.database
          .prepare("SELECT org_id FROM ciphers WHERE id=?")
          .bind(owner.cipherId)
          .first(),
      ).toMatchObject({ org_id: null });
    }
    expect(
      await h.database
        .prepare("SELECT key FROM attachments WHERE id=?")
        .bind(foreign)
        .first(),
    ).toMatchObject({ key: "old-personal-key" });
  },
);

test.each([false, true])(
  "attachment failure rolls back sharing (bulk=%s)",
  async (bulk) => {
    const id = await attachment();
    await h.database.exec(
      "CREATE TRIGGER fail_sharing_attachment BEFORE UPDATE ON attachments BEGIN SELECT RAISE(ABORT, 'test attachment failure'); END;",
    );
    try {
      expect(
        (await share(bulk, { ...itemBody(), attachments2: { [id]: metadata } }))
          .status,
      ).toBe(500);
      expect(
        await h.database
          .prepare("SELECT org_id FROM ciphers WHERE id=?")
          .bind(owner.cipherId)
          .first(),
      ).toMatchObject({ org_id: null });
      expect(
        await h.database
          .prepare("SELECT key FROM attachments WHERE id=?")
          .bind(id)
          .first(),
      ).toMatchObject({ key: "old-personal-key" });
      expect(
        await h.database
          .prepare("SELECT * FROM cipher_collections WHERE cipher_id=?")
          .bind(owner.cipherId)
          .first(),
      ).toBeNull();
    } finally {
      await h.database.exec("DROP TRIGGER fail_sharing_attachment");
    }
  },
);

// Real Bitwarden type-2 EncStrings: sharing must retain a decryptable attachment
// key and filename under the destination owner key, not just return HTTP 200.
function encrypt(bytes: Buffer, key: Buffer) {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const mac = createHmac("sha256", key.subarray(32))
    .update(Buffer.concat([iv, data]))
    .digest();
  return `2.${iv.toString("base64")}|${data.toString("base64")}|${mac.toString("base64")}`;
}
function decrypt(value: string, key: Buffer) {
  const [iv, data, mac] = value
    .slice(2)
    .split("|")
    .map((part) => Buffer.from(part, "base64"));
  expect(
    createHmac("sha256", key.subarray(32))
      .update(Buffer.concat([iv, data]))
      .digest(),
  ).toEqual(mac);
  const cipher = createDecipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
test("shared attachment metadata decrypts with the organization key", async () => {
  const personalKey = randomBytes(64),
    orgKey = randomBytes(64),
    fileKey = randomBytes(64);
  const fileName = Buffer.from("test.txt");
  const id = await attachment(
    owner.cipherId,
    encrypt(fileKey, personalKey),
    encrypt(fileName, personalKey),
  );
  const result = await expectJson<Cipher>(
    await share(false, {
      ...itemBody(),
      attachments2: {
        [id]: {
          key: encrypt(fileKey, orgKey),
          fileName: encrypt(fileName, orgKey),
        },
      },
    }),
  );
  expect(decrypt(result.attachments[0].key, orgKey)).toEqual(fileKey);
  expect(decrypt(result.attachments[0].fileName, orgKey)).toEqual(fileName);
});

test("membership changes notify the affected account including after removal", async () => {
  const publish = vi.spyOn(h.bindings.REALTIME, "getByName");
  const native = vi
    .spyOn(pushRelay, "publishPushOrganizationKeys")
    .mockResolvedValue(true);
  const client = h.authenticated(owner.accessToken);
  const added = await expectJson<{ id: string }>(
    await client.json(memberPath(), inviteBody()),
    201,
  );
  expect(publish).toHaveBeenCalledWith(target.userId);
  expect(native.mock.calls.map((call) => call[1])).toEqual([target.userId]);
  publish.mockClear();
  native.mockClear();
  expect(
    (
      await client.json(
        `${memberPath()}/${added.id}`,
        {
          role: "member",
          accessAll: false,
          collections: [{ id: allowed, readOnly: true, hidePasswords: true }],
        },
        { method: "PUT" },
      )
    ).status,
  ).toBe(200);
  expect(publish).toHaveBeenCalledWith(target.userId);
  expect(native.mock.calls.map((call) => call[1])).toEqual([target.userId]);
  publish.mockClear();
  native.mockClear();
  expect(
    (await client.request(`${memberPath()}/${added.id}`, { method: "DELETE" }))
      .status,
  ).toBe(204);
  expect(publish).toHaveBeenCalledWith(target.userId);
  expect(native.mock.calls.map((call) => call[1])).toEqual([target.userId]);
  const removed = h.authenticated(target.accessToken);
  expect((await removed.request(`/api/ciphers/${shared}`)).status).toBe(404);
  const sync = await expectJson<{
    profile: { organizations: { id: string }[] };
    ciphers: Cipher[];
  }>(await removed.request("/api/sync"));
  expect(sync.profile.organizations.some((item) => item.id === org)).toBe(
    false,
  );
  expect(sync.ciphers.some((item) => item.id === shared)).toBe(false);
  publish.mockClear();
  native.mockClear();
  expect(
    (await client.request(`${memberPath()}/${added.id}`, { method: "DELETE" }))
      .status,
  ).toBe(404);
  expect(publish).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
});
