import { Hono } from "hono";
import type { HonoEnv } from "../../env";
import {
  createCollection,
  createOrganization,
  deleteCollection,
  deleteOrganization,
  getInviteePublicKey,
  getOrganization,
  getOrganizationPublicKey,
  inviteOrganizationMember,
  listCollections,
  listOrganizationMembers,
  listOrganizations,
  removeOrganizationMember,
  updateCollection,
  updateOrganization,
  updateOrganizationMember,
} from "../../handlers/organizations";
import {
  requireCollection,
  requireOrgManager,
  requireOrgMember,
  requireOrgOwner,
} from "../../middleware/resources";

export const organizationBaseRoutes = new Hono<HonoEnv>()
  .get("/api/organizations", ...listOrganizations)
  .get("/api/organizations/:orgId/public-key", ...getOrganizationPublicKey)
  .post("/api/organizations", ...createOrganization)
  .get("/api/organizations/:orgId", requireOrgMember, ...getOrganization)
  .put(
    "/api/organizations/:orgId",
    requireOrgMember,
    requireOrgOwner,
    ...updateOrganization,
  )
  .delete(
    "/api/organizations/:orgId",
    requireOrgMember,
    requireOrgOwner,
    ...deleteOrganization,
  );

export const organizationMemberRoutes = new Hono<HonoEnv>()
  .get(
    "/api/edgewarden/organizations/:orgId/invitee",
    requireOrgMember,
    requireOrgManager,
    ...getInviteePublicKey,
  )
  .get(
    "/api/edgewarden/organizations/:orgId/members",
    requireOrgMember,
    requireOrgManager,
    ...listOrganizationMembers,
  )
  .post(
    "/api/edgewarden/organizations/:orgId/members",
    requireOrgMember,
    requireOrgManager,
    ...inviteOrganizationMember,
  )
  .put(
    "/api/edgewarden/organizations/:orgId/members/:memberId",
    requireOrgMember,
    requireOrgManager,
    ...updateOrganizationMember,
  )
  .delete(
    "/api/edgewarden/organizations/:orgId/members/:memberId",
    requireOrgMember,
    requireOrgManager,
    ...removeOrganizationMember,
  );

export const organizationCollectionRoutes = new Hono<HonoEnv>()
  .get(
    "/api/organizations/:orgId/collections",
    requireOrgMember,
    ...listCollections,
  )
  .post(
    "/api/organizations/:orgId/collections",
    requireOrgMember,
    requireOrgManager,
    ...createCollection,
  )
  .put(
    "/api/organizations/:orgId/collections/:collectionId",
    requireOrgMember,
    requireOrgManager,
    requireCollection,
    ...updateCollection,
  )
  .delete(
    "/api/organizations/:orgId/collections/:collectionId",
    requireOrgMember,
    requireOrgManager,
    requireCollection,
    ...deleteCollection,
  );
