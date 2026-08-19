import { buildBackupArchive } from "../services/backup/archive";
import { createBackupRestoreFixture } from "./backup-restore-fixture";

export async function createOrganizationBackupFixture(options: {
  database: D1Database;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  masterPasswordHash: string;
}): Promise<{
  archive: Uint8Array;
  userId: string;
  organizationId: string;
  collectionId: string;
  accessToken: string;
}> {
  const account = await createBackupRestoreFixture(options);
  const organizationId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const collectionId = crypto.randomUUID();
  const cipherId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const email = await options.database
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(account.userId)
    .first<{ email: string }>()
    .then((row) => row?.email);
  if (!email)
    throw new Error("Organization backup fixture user was not created");

  await options.database
    .prepare(
      "INSERT INTO organizations (id,name,public_key,private_key,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      organizationId,
      "encrypted-organization-name",
      "organization-public-key",
      "encrypted-organization-private-key",
      timestamp,
      timestamp,
    )
    .run();
  await options.database
    .prepare(
      "INSERT INTO org_members (id,org_id,user_id,email,key,role,status,access_all,created_at,updated_at) VALUES (?,?,?,?,?,'owner','confirmed',1,?,?)",
    )
    .bind(
      memberId,
      organizationId,
      account.userId,
      email,
      "encrypted-organization-key",
      timestamp,
      timestamp,
    )
    .run();
  await options.database
    .prepare(
      "INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
    )
    .bind(
      collectionId,
      organizationId,
      "encrypted-collection-name",
      timestamp,
      timestamp,
    )
    .run();
  await options.database
    .prepare(
      "INSERT INTO ciphers (id,org_id,type,name,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(
      cipherId,
      organizationId,
      1,
      "encrypted-organization-cipher",
      JSON.stringify({ login: { username: "encrypted-user" } }),
      timestamp,
      timestamp,
    )
    .run();
  await options.database
    .prepare(
      "INSERT INTO cipher_collections (cipher_id,collection_id,org_id) VALUES (?,?,?)",
    )
    .bind(cipherId, collectionId, organizationId)
    .run();
  await options.database
    .prepare(
      "UPDATE users SET api_key_hash = ?, api_key_encrypted = ? WHERE id = ?",
    )
    .bind(
      "fixture-api-key-hash",
      JSON.stringify({ v: 1, iv: "fixture-iv", data: "fixture-data" }),
      account.userId,
    )
    .run();

  const backup = await buildBackupArchive(options.database, new Date(), {
    includeAttachments: false,
  });
  return {
    archive: backup.bytes,
    userId: account.userId,
    organizationId,
    collectionId,
    accessToken: account.accessToken,
  };
}
