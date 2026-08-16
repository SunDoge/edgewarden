export type ThemePreference = "system" | "light" | "dark";
export type SessionTimeoutAction = "lock" | "logout";

export interface ClientPreferences {
	theme: ThemePreference;
	lockTimeoutMinutes: 0 | 1 | 5 | 15 | 30;
	sessionTimeoutAction: SessionTimeoutAction;
}

const STORAGE_KEY = "edgewarden.client-preferences.v1";
export const CLIENT_PREFERENCES_CHANGED_EVENT =
	"edgewarden:client-preferences-changed";
export const DEFAULT_CLIENT_PREFERENCES: ClientPreferences = {
	theme: "system",
	lockTimeoutMinutes: 15,
	sessionTimeoutAction: "lock",
};
const ClientPreferencesSchema = v.object({
	theme: v.picklist(["system", "light", "dark"]),
	lockTimeoutMinutes: v.picklist([0, 1, 5, 15, 30]),
	sessionTimeoutAction: v.picklist(["lock", "logout"]),
});

export function loadClientPreferences(
	storage: Pick<Storage, "getItem"> = localStorage,
): ClientPreferences {
	const parsed = safeParseJsonWithSchema(
		storage.getItem(STORAGE_KEY) ?? "null",
		ClientPreferencesSchema,
	);
	return parsed ?? { ...DEFAULT_CLIENT_PREFERENCES };
}

export function saveClientPreferences(
	value: ClientPreferences,
	storage: Pick<Storage, "setItem"> = localStorage,
): void {
	storage.setItem(STORAGE_KEY, JSON.stringify(value));
	if (typeof window !== "undefined" && storage === localStorage) {
		window.dispatchEvent(new Event(CLIENT_PREFERENCES_CHANGED_EVENT));
	}
}

export function resolveDarkTheme(
	preference: ThemePreference,
	systemDark: boolean,
): boolean {
	return preference === "dark" || (preference === "system" && systemDark);
}

export function toggledThemePreference(
	preference: ThemePreference,
	systemDark: boolean,
): Exclude<ThemePreference, "system"> {
	return resolveDarkTheme(preference, systemDark) ? "light" : "dark";
}

export function applyThemePreference(
	preference: ThemePreference,
	root: HTMLElement = document.documentElement,
): void {
	const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
	root.classList.toggle("dark", resolveDarkTheme(preference, systemDark));
	root.style.colorScheme = resolveDarkTheme(preference, systemDark)
		? "dark"
		: "light";
}

export function clientPreferencesStorageKey(): string {
	return STORAGE_KEY;
}
import { safeParseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";
