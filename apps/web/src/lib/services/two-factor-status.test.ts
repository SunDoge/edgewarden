import { describe, expect, it } from "vitest";
import { summarizeTwoFactorProviders } from "./two-factor-status";

describe("two-factor provider status", () => {
  it("does not present a WebAuthn-only account as TOTP-enabled", () => {
    expect(
      summarizeTwoFactorProviders([
        { enabled: true, type: 7, object: "twoFactorProvider" },
      ]),
    ).toEqual({ enabled: true, totpEnabled: false, otherEnabled: true });
  });

  it("tracks TOTP independently when providers are mixed", () => {
    expect(
      summarizeTwoFactorProviders([
        { enabled: true, type: 0, object: "twoFactorProvider" },
        { enabled: true, type: 3, object: "twoFactorProvider" },
        { enabled: false, type: 7, object: "twoFactorProvider" },
      ]),
    ).toEqual({ enabled: true, totpEnabled: true, otherEnabled: true });
  });

  it("ignores disabled provider records", () => {
    expect(
      summarizeTwoFactorProviders([
        { enabled: false, type: 0, object: "twoFactorProvider" },
      ]),
    ).toEqual({ enabled: false, totpEnabled: false, otherEnabled: false });
  });
});
