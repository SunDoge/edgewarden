import { describe, expect, it } from "vitest";
import { searchAdminUsers, tokenizeAdminSearch } from "./admin-search";

const users = [
  {
    id: "user-alice",
    email: "alice@example.com",
    name: "Alice Zhang",
    role: "admin",
    status: "active",
    twoFactorEnabled: true,
  },
  {
    id: "user-bob",
    email: "bob@example.net",
    name: "王小明",
    role: "user",
    status: "banned",
    twoFactorEnabled: false,
  },
];

describe("admin user search", () => {
  it("supports weighted fields, prefixes, and typos", () => {
    expect(searchAdminUsers(users, "alice").map((user) => user.id)).toEqual([
      "user-alice",
    ]);
    expect(searchAdminUsers(users, "alic examp")[0]?.id).toBe("user-alice");
    expect(searchAdminUsers(users, "alixe")[0]?.id).toBe("user-alice");
    expect(searchAdminUsers(users, "banned")[0]?.id).toBe("user-bob");
  });

  it("indexes CJK names without requiring whitespace", () => {
    expect(tokenizeAdminSearch("王小明")).toEqual([
      "王",
      "小",
      "明",
      "王小",
      "小明",
    ]);
    expect(searchAdminUsers(users, "小明")[0]?.id).toBe("user-bob");
  });
});
