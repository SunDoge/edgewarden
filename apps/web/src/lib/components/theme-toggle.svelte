<script lang="ts">
import { onMount } from "svelte";
import { Moon, Sun } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import {
	CLIENT_PREFERENCES_CHANGED_EVENT,
	applyThemePreference,
	clientPreferencesStorageKey,
	loadClientPreferences,
	resolveDarkTheme,
	saveClientPreferences,
	toggledThemePreference,
} from "$lib/services/client-preferences";
import { m } from "$lib/paraglide/messages.js";

let dark = $state(false);

function refresh() {
	const preference = loadClientPreferences().theme;
	dark = resolveDarkTheme(
		preference,
		matchMedia("(prefers-color-scheme: dark)").matches,
	);
}

function toggleTheme() {
	const preferences = loadClientPreferences();
	preferences.theme = toggledThemePreference(
		preferences.theme,
		matchMedia("(prefers-color-scheme: dark)").matches,
	);
	saveClientPreferences(preferences);
	applyThemePreference(preferences.theme);
	refresh();
}

onMount(() => {
	const media = matchMedia("(prefers-color-scheme: dark)");
	const onStorage = (event: StorageEvent) => {
		if (event.key === clientPreferencesStorageKey()) refresh();
	};
	refresh();
	media.addEventListener("change", refresh);
	window.addEventListener("storage", onStorage);
	window.addEventListener(CLIENT_PREFERENCES_CHANGED_EVENT, refresh);
	return () => {
		media.removeEventListener("change", refresh);
		window.removeEventListener("storage", onStorage);
		window.removeEventListener(CLIENT_PREFERENCES_CHANGED_EVENT, refresh);
	};
});
</script>

<Button
	type="button"
	variant="ghost"
	size="icon"
	onclick={toggleTheme}
	aria-label={dark ? m.theme_use_light() : m.theme_use_dark()}
	title={dark ? m.theme_use_light() : m.theme_use_dark()}
>
	{#if dark}<Sun />{:else}<Moon />{/if}
</Button>
