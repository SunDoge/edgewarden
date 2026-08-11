import { describe, expect, it } from "vitest";
import { normalizeTotpQrValue } from "./totp-qr";

describe("TOTP QR import", () => {
	it("accepts standard and Steam authenticator payloads", () => {
		expect(
			normalizeTotpQrValue(
				"otpauth://totp/Edgewarden?secret=JBSWY3DPEHPK3PXP&issuer=Edgewarden",
			),
		).toContain("otpauth://totp/");
		expect(normalizeTotpQrValue("steam://JBSWY3DPEHPK3PXP")).toBe(
			"steam://JBSWY3DPEHPK3PXP",
		);
	});

	it("rejects URLs and malformed authenticator payloads", () => {
		expect(normalizeTotpQrValue("https://example.com")).toBeNull();
		expect(normalizeTotpQrValue("otpauth://hotp/Test?secret=ABC")).toBeNull();
		expect(normalizeTotpQrValue("otpauth://totp/Test")).toBeNull();
	});
});
