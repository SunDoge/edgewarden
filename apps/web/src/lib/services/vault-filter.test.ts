import { type CipherResponse, CipherType } from "@edgewarden/shared";
import { describe, expect, it } from "vitest";
import {
  filterAndSortVaultItems,
  findDuplicateCipherGroups,
  findDuplicateCipherIds,
  findRedundantDuplicateCipherIds,
} from "./vault-filter";

function cipher(overrides: Partial<CipherResponse>): CipherResponse {
  return {
    id: crypto.randomUUID(),
    organizationId: null,
    folderId: null,
    type: CipherType.Login,
    name: "Item",
    notes: null,
    fields: null,
    data: null,
    login: null,
    secureNote: null,
    card: null,
    identity: null,
    sshKey: null,
    favorite: false,
    reprompt: 0,
    key: null,
    attachments: null,
    collectionIds: [],
    revisionDate: "2026-01-01T00:00:00.000Z",
    creationDate: "2026-01-01T00:00:00.000Z",
    deletedDate: null,
    archivedDate: null,
    passwordHistory: null,
    object: "cipher",
    ...overrides,
  };
}

describe("vault filtering", () => {
  it("keeps deleted items out of normal views and only in trash", () => {
    const active = cipher({ id: "active" });
    const deleted = cipher({
      id: "deleted",
      deletedDate: "2026-02-01T00:00:00.000Z",
    });
    expect(
      filterAndSortVaultItems([active, deleted], {
        category: "all",
        folderId: null,
        query: "",
        sort: "name",
      }).map((item) => item.id),
    ).toEqual(["active"]);
    expect(
      filterAndSortVaultItems([active, deleted], {
        category: "trash",
        folderId: null,
        query: "",
        sort: "name",
      }).map((item) => item.id),
    ).toEqual(["deleted"]);
  });

  it("keeps archived items only in the archive view", () => {
    const active = cipher({ id: "active" });
    const archived = cipher({
      id: "archived",
      archivedDate: "2026-02-01T00:00:00.000Z",
    });
    expect(
      filterAndSortVaultItems([active, archived], {
        category: "all",
        folderId: null,
        query: "",
        sort: "name",
      }).map((item) => item.id),
    ).toEqual(["active"]);
    expect(
      filterAndSortVaultItems([active, archived], {
        category: "archive",
        folderId: null,
        query: "",
        sort: "name",
      }).map((item) => item.id),
    ).toEqual(["archived"]);
  });

  it("searches names, notes, usernames and URIs case-insensitively", () => {
    const item = cipher({
      name: "GitHub",
      notes: "Work",
      login: { username: "Me@Example.com", uri: "https://github.com" },
    });
    for (const query of ["github", "work", "ME@example", "HTTPS://GITHUB"])
      expect(
        filterAndSortVaultItems([item], {
          category: "all",
          folderId: null,
          query,
          sort: "name",
        }),
      ).toHaveLength(1);
  });

  it("applies folder, favorite and stable date sorting", () => {
    const older = cipher({
      id: "older",
      name: "Z",
      folderId: "folder",
      favorite: true,
      revisionDate: "2025-01-01T00:00:00Z",
    });
    const newer = cipher({
      id: "newer",
      name: "A",
      folderId: "folder",
      favorite: true,
      revisionDate: "2026-01-01T00:00:00Z",
    });
    expect(
      filterAndSortVaultItems([older, newer], {
        category: "favorites",
        folderId: "folder",
        query: "",
        sort: "edited",
      }).map((item) => item.id),
    ).toEqual(["newer", "older"]);
  });

  it("detects duplicate logins by account, password and exact data", () => {
    const first = cipher({
      id: "first",
      name: "GitHub",
      login: {
        username: "me",
        password: "same",
        uri: "https://github.com/login",
      },
    });
    const second = cipher({
      id: "second",
      name: "Other",
      login: { username: "me", password: "same", uri: "github.com/settings" },
    });
    const third = cipher({
      id: "third",
      name: "Different",
      login: { username: "other", password: "different", uri: "example.com" },
    });
    expect(
      findDuplicateCipherIds([first, second, third], "login-site"),
    ).toEqual(new Set(["first", "second"]));
    expect(
      findDuplicateCipherIds([first, second, third], "login-credentials"),
    ).toEqual(new Set(["first", "second"]));
    expect(findDuplicateCipherIds([first, second, third], "password")).toEqual(
      new Set(["first", "second"]),
    );
    expect(
      findDuplicateCipherIds([first, { ...first, id: "copy" }], "exact"),
    ).toEqual(new Set(["first", "copy"]));
  });

  it("does not treat different accounts on the same site as duplicates", () => {
    const alice = cipher({
      id: "alice",
      name: "GitHub Alice",
      login: { username: "alice", password: "one", uri: "github.com" },
    });
    const bob = cipher({
      id: "bob",
      name: "GitHub Bob",
      login: {
        username: "bob",
        password: "two",
        uri: "https://github.com/login",
      },
    });

    expect(findDuplicateCipherIds([alice, bob], "login-credentials")).toEqual(
      new Set(),
    );
    expect(findDuplicateCipherIds([alice, bob], "login-site")).toEqual(
      new Set(),
    );
  });

  it("requires both username and password to match for an account duplicate", () => {
    const oldPassword = cipher({
      id: "old",
      login: { username: "alice", password: "old", uri: "example.com" },
    });
    const newPassword = cipher({
      id: "new",
      login: { username: "alice", password: "new", uri: "example.com" },
    });

    expect(
      findDuplicateCipherIds([oldPassword, newPassword], "login-credentials"),
    ).toEqual(new Set());
    expect(
      findDuplicateCipherIds([oldPassword, newPassword], "login-site"),
    ).toEqual(new Set());
  });

  it("groups equivalent empty defaults and keeps the newest duplicate", () => {
    const older = cipher({
      id: "older",
      revisionDate: "2026-01-01T00:00:00Z",
      login: {
        username: "alice",
        password: "secret",
        uris: [{ uri: "https://example.com", match: null }],
        fido2Credentials: [],
      },
      fields: [],
    });
    const newer = cipher({
      id: "newer",
      revisionDate: "2026-02-01T00:00:00Z",
      login: {
        username: "alice",
        password: "secret",
        uris: [{ uri: "https://example.com" }],
      },
      fields: null,
    });

    expect(findDuplicateCipherGroups([older, newer], "exact")).toEqual([
      ["older", "newer"],
    ]);
    expect(findRedundantDuplicateCipherIds([older, newer], "exact")).toEqual(
      new Set(["older"]),
    );
  });
});
