import { describe, expect, it } from "vitest";
import type { BackupPayload } from "./archive";
import { validateBackupOrganizationGraph } from "./import-prepare";

function organizationGraph(): BackupPayload["db"] {
  return {
    config: [],
    users: [],
    domain_settings: [],
    user_revisions: [],
    organizations: [{ id: "org-a" }, { id: "org-b" }],
    org_members: [
      { id: "member-a", org_id: "org-a", user_id: "user-a" },
      { id: "member-b", org_id: "org-b", user_id: "user-b" },
    ],
    collections: [
      { id: "collection-a", org_id: "org-a" },
      { id: "collection-b", org_id: "org-b" },
    ],
    collection_members: [
      { collection_id: "collection-a", org_member_id: "member-a" },
    ],
    folders: [],
    ciphers: [
      { id: "cipher-a", org_id: "org-a", user_id: null },
      { id: "personal", org_id: null, user_id: "user-a" },
    ],
    cipher_user_settings: [{ cipher_id: "cipher-a", user_id: "user-a" }],
    cipher_collections: [
      { cipher_id: "cipher-a", collection_id: "collection-a" },
    ],
    attachments: [],
    webauthn_credentials: [],
    device_trust_tokens: [],
    audit_logs: [],
    sends: [],
  };
}

describe("backup organization graph validation", () => {
  it("accepts organization-local authorization relationships", () => {
    expect(() =>
      validateBackupOrganizationGraph(organizationGraph()),
    ).not.toThrow();
  });

  it("rejects collection membership across organizations", () => {
    const db = organizationGraph();
    db.collection_members = [
      { collection_id: "collection-a", org_member_id: "member-b" },
    ];
    expect(() => validateBackupOrganizationGraph(db)).toThrow(
      /crosses organization boundary/,
    );
  });

  it("rejects personal or cross-organization cipher collection links", () => {
    const db = organizationGraph();
    db.cipher_collections = [
      { cipher_id: "personal", collection_id: "collection-a" },
    ];
    expect(() => validateBackupOrganizationGraph(db)).toThrow(
      /cipher collection crosses organization boundary/,
    );
  });

  it("rejects organization user state attached to a personal cipher", () => {
    const db = organizationGraph();
    db.cipher_user_settings = [{ cipher_id: "personal", user_id: "user-a" }];
    expect(() => validateBackupOrganizationGraph(db)).toThrow(
      /personal cipher cannot have organization user settings/,
    );
  });
});
