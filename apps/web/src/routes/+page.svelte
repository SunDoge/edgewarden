<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { isLoggedIn } from "$lib/services/api-auth";
  import { restoreWebSession } from "$lib/services/rpc";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import LandingPage from "$lib/components/LandingPage.svelte";
  import { loadLandingSettings } from "$lib/services/landing";
  import { m } from "$lib/paraglide/messages.js";

  let landing = $state<{ enabled: boolean; demo: boolean } | null>(null);
  onMount(() => {
    const controller = new AbortController();
    async function initialize() {
      const settings = await loadLandingSettings(controller.signal);
      if (controller.signal.aborted) return;
      landing = settings;
      // An enabled landing page is public and must not refresh a session or
      // redirect returning Demo visitors before they choose to enter the vault.
      if (settings.enabled) return;
      try {
        await restoreWebSession();
      } catch {
        // Login stays reachable when a stale session cannot be restored.
      }
      if (!controller.signal.aborted)
        await goto(isLoggedIn() ? "/vault" : "/login", { replaceState: true });
    }
    void initialize();
    return () => controller.abort();
  });
</script>

{#if landing?.enabled}
  <LandingPage demo={landing.demo} />
{:else}
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30">
    <Empty.Root
      ><Empty.Media variant="icon"><Spinner /></Empty.Media><Empty.Header
        ><Empty.Title>{m.landing_loading()}</Empty.Title><Empty.Description
          >{m.landing_loading_description()}</Empty.Description
        ></Empty.Header
      ></Empty.Root
    >
    <Button href="/login" variant="outline">{m.landing_open_vault()}</Button>
  </div>
{/if}
