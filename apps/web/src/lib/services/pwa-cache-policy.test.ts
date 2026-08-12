import { describe, expect, it } from "vitest";
import { isSensitiveCachePath, mayCacheRequest } from "./pwa-cache-policy";

describe("PWA cache security policy", () => {
	it.each([
		"/api/sync",
		"/api/ciphers",
		"/identity/connect/token",
		"/webauthn",
		"/webauthn/assertion-options",
	])("never caches sensitive endpoint %s", (path) => {
		expect(isSensitiveCachePath(path)).toBe(true);
		expect(
			mayCacheRequest("GET", `https://vault.test${path}`, "https://vault.test"),
		).toBe(false);
	});

	it("only permits same-origin GET shell resources", () => {
		expect(
			mayCacheRequest("GET", "https://vault.test/vault", "https://vault.test"),
		).toBe(true);
		expect(
			mayCacheRequest("POST", "https://vault.test/vault", "https://vault.test"),
		).toBe(false);
		expect(
			mayCacheRequest("GET", "https://cdn.test/app.js", "https://vault.test"),
		).toBe(false);
	});
});
