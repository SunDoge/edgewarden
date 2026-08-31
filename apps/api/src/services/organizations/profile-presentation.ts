export interface ProfileOrganizationRow {
  member_id: string;
  org_id: string;
  key: string | null;
  role: string;
  access_all: number;
  name: string;
  public_key: string | null;
  private_key: string | null;
}

export function organizationRoleType(role: string): number {
  return role === "owner"
    ? 0
    : role === "admin"
      ? 1
      : role === "manager"
        ? 4
        : 2;
}

export function profileOrganizationToResponse(
  row: ProfileOrganizationRow,
  userId: string,
) {
  const type = organizationRoleType(row.role);
  const customManager = type === 4;
  return {
    id: row.org_id,
    userId,
    organizationUserId: row.member_id,
    identifier: null,
    name: row.name,
    key: row.key,
    publicKey: row.public_key,
    privateKey: row.private_key,
    role: row.role,
    status: 2,
    type,
    enabled: true,
    productTierType: 0,
    accessAll: Boolean(row.access_all),
    usersGetPremium: true,
    usePolicies: true,
    useSso: false,
    useKeyConnector: false,
    useScim: false,
    useGroups: false,
    useDirectory: false,
    useEvents: false,
    useTotp: true,
    use2fa: true,
    useApi: true,
    useResetPassword: false,
    useSecretsManager: false,
    usePasswordManager: true,
    useCustomPermissions: true,
    useActivateAutofillPolicy: false,
    useRiskInsights: false,
    useOrganizationDomains: false,
    useAdminSponsoredFamilies: false,
    useAutomaticUserConfirmation: false,
    useDisableSMAdsForUsers: true,
    usePhishingBlocker: false,
    useMyItems: false,
    useInviteLinks: false,
    usePam: false,
    selfHost: true,
    seats: 20,
    maxCollections: null,
    maxStorageGb: 32767,
    hasPublicAndPrivateKeys: Boolean(row.public_key && row.private_key),
    ssoBound: false,
    resetPasswordEnrolled: false,
    limitCollectionCreation: customManager && !row.access_all,
    limitCollectionDeletion: true,
    limitItemDeletion: false,
    allowAdminAccessToAllCollectionItems: true,
    providerId: null,
    providerName: null,
    providerType: null,
    ssoEnabled: false,
    keyConnectorEnabled: false,
    keyConnectorUrl: null,
    ssoMemberDecryptionType: null,
    accessSecretsManager: false,
    accessPam: false,
    userIsClaimedByOrganization: false,
    userIsManagedByOrganization: false,
    familySponsorshipFriendlyName: null,
    familySponsorshipAvailable: false,
    familySponsorshipLastSyncDate: null,
    familySponsorshipValidUntil: null,
    familySponsorshipToDelete: null,
    isAdminInitiated: false,
    permissions: customManager
      ? {
          accessEventLogs: false,
          accessImportExport: false,
          accessReports: false,
          createNewCollections: Boolean(row.access_all),
          editAnyCollection: Boolean(row.access_all),
          deleteAnyCollection: Boolean(row.access_all),
          manageGroups: false,
          managePolicies: false,
          manageSso: false,
          manageUsers: false,
          manageResetPassword: false,
          manageScim: false,
        }
      : null,
    object: "profileOrganization",
  };
}
