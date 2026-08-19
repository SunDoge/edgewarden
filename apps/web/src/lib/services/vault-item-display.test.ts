import { CipherType, type CipherResponse } from "@edgewarden/shared";
import { describe, expect, it } from "vitest";
import { cipherDomain, cipherTypeName } from "./vault-item-display";

function login(uri: string): CipherResponse {
  return {
    id: "cipher",
    type: CipherType.Login,
    login: { uris: [{ uri }] },
  } as unknown as CipherResponse;
}

describe("vault item display helpers", () => {
  it("normalizes website hosts used by icons", () => {
    expect(cipherDomain(login("https://www.example.com/login"))).toBe(
      "example.com",
    );
    expect(cipherDomain(login("accounts.example.com/path"))).toBe(
      "accounts.example.com",
    );
  });

  it("returns null for non-login items and malformed empty URIs", () => {
    expect(
      cipherDomain({
        id: "note",
        type: CipherType.SecureNote,
      } as unknown as CipherResponse),
    ).toBeNull();
    expect(cipherDomain(login(""))).toBeNull();
  });

  it("provides a stable fallback type label", () => {
    expect(cipherTypeName(CipherType.Passport)).toBe("护照");
    expect(cipherTypeName(999)).toBe("保险库项");
  });
});
