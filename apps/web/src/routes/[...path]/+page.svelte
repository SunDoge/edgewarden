<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Home } from "@lucide/svelte";
</script>

<svelte:head><title>{m.ui_page_not_found_edgewarden()}</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
  <Card.Root class="w-full max-w-lg text-center"
    ><Card.Header
      ><div class="text-6xl font-bold tracking-tight">404</div>
      <Card.Title>{m.ui_page_not_found()}</Card.Title><Card.Description
        >{m.ui_this_address_does_not_exist_or_the_page_has_moved()}</Card.Description
      ></Card.Header
    ><Card.Footer class="justify-center"
      ><Button onclick={() => goto("/")}><Home />{m.ui_back_to_home()}</Button></Card.Footer
    ></Card.Root
  >
</main>
