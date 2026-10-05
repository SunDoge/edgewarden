import { safeParse } from "valibot";
import { describe, expect, it } from "vitest";
import { TokenFormSchema } from "../schemas/identity";
import {
  isWebClient,
  readDeviceInfo,
  webRefreshCookieName,
} from "./identity-token-helpers";

describe("identity token helpers", () => {
  it("normalizes device information from compatible field names", () => {
    expect(
      readDeviceInfo({
        DeviceIdentifier: " device-id ",
        DeviceName: "Browser",
        DeviceType: "3",
        DevicePushToken: " mobile-push-token ",
      }),
    ).toEqual({
      identifier: "device-id",
      name: "Browser",
      type: 3,
      pushToken: "mobile-push-token",
    });
  });

  it.each(["NaN", "-1", "1.5", "256", "01", ""])(
    "rejects malformed device type %j at the token boundary",
    (deviceType) => {
      expect(
        safeParse(TokenFormSchema, {
          grant_type: "password",
          deviceType,
        }).success,
      ).toBe(false);
    },
  );

  it.each(["0", "14", "255"])(
    "accepts Bitwarden device type %s",
    (deviceType) => {
      expect(
        safeParse(TokenFormSchema, {
          grant_type: "password",
          deviceType,
        }).success,
      ).toBe(true);
    },
  );

  it("uses host-only refresh cookies for HTTPS", () => {
    expect(
      webRefreshCookieName("https://vault.example.test/connect/token"),
    ).toBe("__Host-edgewarden_refresh");
    expect(webRefreshCookieName("http://localhost/connect/token")).toBe(
      "edgewarden_refresh",
    );
  });

  it("recognizes only the web OAuth client", () => {
    expect(isWebClient({ client_id: " web " })).toBe(true);
    expect(isWebClient({ client_id: "cli" })).toBe(false);
  });
});
