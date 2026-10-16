<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { ShieldCheck } from "@lucide/svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { listPendingAuthRequestsApi } from "$lib/services/auth-requests";

  let {
    email,
    refreshVersion,
  }: {
    email: string;
    refreshVersion: number;
  } = $props();

  let pendingCount = $state(0);
  let loadVersion = 0;

  async function refresh() {
    if (!email) return;
    const version = ++loadVersion;
    try {
      const requests = await listPendingAuthRequestsApi(email);
      if (version === loadVersion) pendingCount = requests.length;
    } catch {
      // This is a convenience prompt. The settings page remains the recovery path.
    }
  }

  $effect(() => {
    email;
    refreshVersion;
    void refresh();
  });

  onMount(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  });
</script>

{#if pendingCount > 0}
  <div class="border-b bg-muted/30 p-2 sm:px-4" aria-live="polite">
    <Alert.Root>
      <ShieldCheck />
      <Alert.Title>{m.ui_new_device_login_request()}</Alert.Title>
      <Alert.Description>
        {pendingCount === 1
          ? m.ui_verify_the_fingerprint_phrase_and_device_information_before_approving()
          : m.ui_requests_awaiting_verification_value({ value0: pendingCount })}
      </Alert.Description>
      <Alert.Action>
        <Button size="sm" onclick={() => goto("/vault/settings?tab=security#device-login-requests")}
          >{m.ui_review_requests()}</Button
        >
      </Alert.Action>
    </Alert.Root>
  </div>
{/if}
