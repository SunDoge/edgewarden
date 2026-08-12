import { describe, expect, it } from "vitest";
import {
	DEFAULT_CLIENT_PREFERENCES,
	loadClientPreferences,
	resolveDarkTheme,
	saveClientPreferences,
} from "./client-preferences";

describe("client preferences", () => {
	it("fails closed to safe defaults for malformed storage", () => {
		expect(loadClientPreferences({ getItem: () => "not-json" })).toEqual(
			DEFAULT_CLIENT_PREFERENCES,
		);
		expect(
			loadClientPreferences({
				getItem: () => JSON.stringify({ theme: "evil" }),
			}),
		).toEqual(DEFAULT_CLIENT_PREFERENCES);
	});

	it("round trips only non-sensitive display and timeout settings", () => {
		let stored = "";
		const value = {
			theme: "dark",
			lockTimeoutMinutes: 5,
			sessionTimeoutAction: "logout",
		} as const;
		saveClientPreferences(value, {
			setItem: (_key, next) => {
				stored = next;
			},
		});
		expect(loadClientPreferences({ getItem: () => stored })).toEqual(value);
		expect(stored).not.toMatch(/password|key|token/i);
	});

	it("resolves system, light and dark themes", () => {
		expect(resolveDarkTheme("system", true)).toBe(true);
		expect(resolveDarkTheme("system", false)).toBe(false);
		expect(resolveDarkTheme("light", true)).toBe(false);
		expect(resolveDarkTheme("dark", false)).toBe(true);
	});
});
