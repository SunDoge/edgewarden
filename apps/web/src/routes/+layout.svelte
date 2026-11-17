<script lang="ts">
  import "./layout.css";
  import { restoreLocalePreference } from "#lib/i18n/locale.svelte.ts";
  import { onMount } from "svelte";
  import DemoNotice from "#lib/components/DemoNotice.svelte";
  import {
    applyThemePreference,
    clientPreferencesStorageKey,
    loadClientPreferences,
  } from "#lib/services/client-preferences.ts";
  import { syncDocumentLocale } from "#lib/i18n/format.ts";
  import { Toaster } from "#lib/components/ui/sonner/index.js";

  let { children } = $props();

  onMount(() => {
    restoreLocalePreference();
    syncDocumentLocale();

    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyThemePreference(loadClientPreferences().theme);
    const onStorage = (event: StorageEvent) => {
      if (event.key === clientPreferencesStorageKey()) apply();
    };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", onStorage);
    };
  });
</script>

<svelte:head>
  <link rel="icon" href="/edgewarden-icon.svg" type="image/svg+xml" />
  <meta name="theme-color" content="#0f172a" />
</svelte:head>
{@render children()}
<DemoNotice />
<Toaster richColors position="top-center" />
