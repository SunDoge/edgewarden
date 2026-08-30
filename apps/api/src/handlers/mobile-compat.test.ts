import { describe, expect, it } from "vitest";
import { shouldRateLimitIdentityGrant } from "./identity-token";
import { supportsSshKeys } from "./sync";

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
});
