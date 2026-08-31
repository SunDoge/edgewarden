import { describe, expect, it } from "vitest";
import { profileOrganizationToResponse } from "../services/organizations/profile-presentation";
import { shouldRateLimitIdentityGrant } from "./identity-token";
import { organizationRoleType, supportsSshKeys } from "./sync";

describe("mobile client compatibility", () => {
  it("does not spend the login rate limit on refresh token rotation", () => {
    expect(shouldRateLimitIdentityGrant("refresh_token")).toBe(false);
    expect(shouldRateLimitIdentityGrant("password")).toBe(true);
    expect(shouldRateLimitIdentityGrant("webauthn")).toBe(true);
    expect(shouldRateLimitIdentityGrant("client_credentials")).toBe(true);
  });

  it("withholds SSH keys only from clients that identify as pre-2024.12", () => {
    expect(supportsSshKeys("2024.11.2")).toBe(false);
    expect(supportsSshKeys("2024.12.0")).toBe(true);
    expect(supportsSshKeys("2026.8.1")).toBe(true);
    expect(supportsSshKeys(undefined)).toBe(true);
    expect(supportsSshKeys("not-semver")).toBe(true);
  });

  it("maps internal organization roles to Bitwarden integer enums", () => {
    expect(organizationRoleType("owner")).toBe(0);
    expect(organizationRoleType("admin")).toBe(1);
    expect(organizationRoleType("member")).toBe(2);
    expect(organizationRoleType("manager")).toBe(4);
  });

  it("includes the complete native-client organization profile contract", () => {
    const organization = profileOrganizationToResponse(
      {
        member_id: "member-id",
        org_id: "org-id",
        key: "2.encrypted-key",
        role: "owner",
        access_all: 1,
        name: "Organization",
        public_key: null,
        private_key: null,
      },
      "user-id",
    );

    expect(organization).toMatchObject({
      status: 2,
      type: 0,
      productTierType: 0,
      ssoEnabled: false,
      keyConnectorEnabled: false,
      keyConnectorUrl: null,
      ssoMemberDecryptionType: null,
      providerId: null,
      providerName: null,
      providerType: null,
      accessSecretsManager: false,
      accessPam: false,
      permissions: {
        accessEventLogs: false,
        accessImportExport: false,
        accessReports: false,
        createNewCollections: false,
        editAnyCollection: false,
        deleteAnyCollection: false,
        manageGroups: false,
        managePolicies: false,
        manageSso: false,
        manageUsers: false,
        manageResetPassword: false,
        manageScim: false,
        manageAccessRules: false,
      },
      familySponsorshipFriendlyName: null,
      familySponsorshipAvailable: false,
      familySponsorshipLastSyncDate: null,
      familySponsorshipValidUntil: null,
      familySponsorshipToDelete: null,
      isAdminInitiated: false,
    });
  });
});
