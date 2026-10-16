import type { Context } from "hono";
import type { Selectable } from "kysely";
import type { HonoEnv } from "../../env";
import {
  getCipherPermissions,
  getVisibleCipherCollectionIds,
} from "../../services/ciphers/access";
import { cipherToResponse } from "../../services/ciphers/presentation";
import * as attachmentsDb from "../../services/db/attachments";
import * as ciphersDb from "../../services/db/ciphers";
import type { OrgMembers } from "../../types/db";

export async function loadCipherResponse(
  c: Context<HonoEnv>,
  cipherId: string,
  member: Selectable<OrgMembers> | undefined = c.get("orgMember"),
) {
  const db = c.get("db");
  const cipher = await ciphersDb.getCipherById(db, cipherId, c.get("user").id);
  if (!cipher) return null;
  if (cipher.org_id) {
    // Re-read membership after mutations, including initial sharing and
    // collection changes. Never default an organization response to full access.
    member = await db
      .selectFrom("org_members")
      .selectAll()
      .where("org_id", "=", cipher.org_id)
      .where("user_id", "=", c.get("user").id)
      .where("status", "=", "confirmed")
      .executeTakeFirst();
    if (!member) return null;
  } else if (cipher.user_id !== c.get("user").id) return null;
  const collectionIds = await getVisibleCipherCollectionIds(
    db,
    cipher.id,
    member,
  );
  const permissions = await getCipherPermissions(
    db,
    cipher,
    member,
    collectionIds,
  );
  if (cipher.org_id && !member?.access_all && !collectionIds.length)
    return null;
  return cipherToResponse(
    cipher,
    await attachmentsDb.listByCipherIds(db, [cipher.id]),
    collectionIds,
    permissions,
  );
}
