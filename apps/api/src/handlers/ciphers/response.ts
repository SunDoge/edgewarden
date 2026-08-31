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
  return cipherToResponse(
    cipher,
    await attachmentsDb.listByCipherIds(db, [cipher.id]),
    collectionIds,
    permissions,
  );
}
