import type {
  CollectionResponse,
  ProfileOrganizationResponse,
} from "@edgewarden/shared";

export type OrganizationRole = ProfileOrganizationResponse["role"];
export type OrganizationSummary = ProfileOrganizationResponse;

export interface OrganizationCollection extends CollectionResponse {
  manage?: boolean;
}

export interface OrganizationMemberCollectionAccess {
  id: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage?: boolean;
}

export interface OrganizationMember {
  id: string;
  userId: string | null;
  email: string;
  role: OrganizationRole;
  status: string;
  accessAll: boolean;
  collections: OrganizationMemberCollectionAccess[];
  creationDate: string;
  object: string;
}

export interface OrganizationInvitee {
  id: string;
  email: string;
  publicKey: string;
  object: string;
}

export interface ApiList<T> {
  data: T[];
  object: string;
  continuationToken: string | null;
}

export interface MemberCollectionAccessEditor {
  selected: boolean;
  readOnly: boolean;
  hidePasswords: boolean;
}

export type OrganizationRenameTarget = {
  kind: "organization" | "collection";
  id: string;
};

export type OrganizationRemoveTarget = {
  kind: "member" | "collection";
  id: string;
  name: string;
};
