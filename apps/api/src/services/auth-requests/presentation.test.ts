import { describe, expect, it } from "vitest";
import {
  authRequestToResponse,
  type AuthRequestPresentationRow,
} from "./presentation";

function row(
  overrides: Partial<AuthRequestPresentationRow> = {},
): AuthRequestPresentationRow {
  return {
    id: "request-id",
    request_device_identifier: "device-id",
    request_device_type: 1,
    request_ip_address: null,
    request_country_name: null,
    public_key: "public-key",
    key: null,
    master_password_hash: null,
    approved: null,
    creation_date: 1_700_000_000,
    response_date: null,
    ...overrides,
  };
}

describe("auth request presentation", () => {
  it("maps the current Bitwarden device type and response fields", () => {
    expect(
      authRequestToResponse(
        row({
          approved: 1,
          key: "encrypted-key",
          response_date: 1_700_000_001,
        }),
        "vault.example.com",
      ),
    ).toMatchObject({
      requestDeviceTypeValue: 1,
      requestDeviceType: "iOS",
      requestApproved: true,
      key: "encrypted-key",
      origin: "vault.example.com",
      creationDate: "2023-11-14T22:13:20.000Z",
      responseDate: "2023-11-14T22:13:21.000Z",
      object: "auth-request",
    });
  });

  it("uses a stable label for a future unknown device type", () => {
    expect(
      authRequestToResponse(row({ request_device_type: 255 }), "example.com")
        .requestDeviceType,
    ).toBe("Unknown Browser");
  });
});
