<script lang="ts">
  import { onMount } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages.js";

  let demo = $state<{ email: string; password: string } | null>(null);
  let origin = $state("");
  onMount(() => {
    origin = window.location.origin;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/demo", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) throw new Error("Demo status unavailable");
        const status = await response.json();
        if (
          status.enabled === true &&
          status.readOnly === true &&
          typeof status.email === "string" &&
          typeof status.password === "string"
        ) {
          demo = { email: status.email, password: status.password };
        } else if (status.enabled === false) demo = null;
        else throw new Error("Invalid Demo status");
      } catch {
        // A failed status request must not advertise production as a public Demo.
      }
    }
    void refresh();
    return () => {
      controller.abort();
    };
  });
</script>

{#if demo}
  <Dialog.Root>
    <div class="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-30">
      <Dialog.Trigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" {...props}>{m.demo_badge()}</Button>
        {/snippet}
      </Dialog.Trigger>
    </div>
    <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <Dialog.Header>
        <Dialog.Title>{m.demo_title()}</Dialog.Title>
        <Dialog.Description>{m.demo_warning()}</Dialog.Description>
      </Dialog.Header>
      <div class="flex flex-col gap-3">
        <p class="break-all">{m.demo_email()}<code>{demo.email}</code></p>
        <p class="break-all">{m.demo_password()}<code>{demo.password}</code></p>
        <p class="break-all">{m.demo_client_instructions()}<code>{origin}</code></p>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            href="https://github.com/SunDoge/edgewarden#deploy-to-cloudflare"
            target="_blank"
            rel="noopener noreferrer">{m.demo_self_host()}</Button
          >
          <Button
            variant="ghost"
            size="sm"
            href="https://github.com/SunDoge/edgewarden/issues"
            target="_blank"
            rel="noopener noreferrer">{m.demo_feedback()}</Button
          >
          <Button
            variant="ghost"
            size="sm"
            href="https://github.com/SunDoge/edgewarden"
            target="_blank"
            rel="noopener noreferrer">{m.demo_contribute()}</Button
          >
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/if}
