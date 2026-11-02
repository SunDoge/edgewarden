<script lang="ts">
  import { onMount } from "svelte";
  import { preloadCode } from "$app/navigation";
  import { navigating } from "$app/state";
  import { warmRoutes } from "$lib/services/route-preload";
  import { vault } from "$lib/stores/vault.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import VaultAppSidebar from "./VaultAppSidebar.svelte";

  let { mobileOpen = $bindable(false) }: { mobileOpen: boolean } = $props();

  // One queue shared by the desktop sidebar and mobile sheet. Other tools load
  // on hover/tap rather than all competing as soon as the sidebar appears.
  onMount(() =>
    warmRoutes(
      ["/vault/generator", "/vault/settings"],
      preloadCode,
      () => vault.isUnlocked && !vault.isSyncing && !navigating.to,
    ),
  );
</script>

<Sheet.Root bind:open={mobileOpen}>
  <Sheet.Content side="left" class="w-72 gap-0 p-0 md:hidden" showCloseButton={false}>
    <Sheet.Header class="sr-only">
      <Sheet.Title>{m.nav_label()}</Sheet.Title>
      <Sheet.Description>{m.nav_description()}</Sheet.Description>
    </Sheet.Header>
    <VaultAppSidebar onNavigate={() => (mobileOpen = false)} />
  </Sheet.Content>
</Sheet.Root>

<div class="hidden md:flex">
  <VaultAppSidebar />
</div>
