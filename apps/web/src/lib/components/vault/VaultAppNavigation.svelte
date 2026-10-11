<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import VaultAppSidebar from "./VaultAppSidebar.svelte";

  let { mobileOpen = $bindable(false) }: { mobileOpen: boolean } = $props();
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
