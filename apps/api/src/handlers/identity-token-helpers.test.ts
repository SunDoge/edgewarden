import { describe, expect, it } from "vitest";
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
			}),
		).toEqual({ identifier: "device-id", name: "Browser", type: 3 });
	});

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
