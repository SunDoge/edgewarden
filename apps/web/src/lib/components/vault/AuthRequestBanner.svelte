<script lang="ts">
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
      <Alert.Title>有新的设备登录请求</Alert.Title>
      <Alert.Description>
        {pendingCount === 1
          ? "请核对验证短语和设备信息后决定是否批准。"
          : `共有 ${pendingCount} 个请求等待核对。`}
      </Alert.Description>
      <Alert.Action>
        <Button size="sm" onclick={() => goto("/vault/settings?tab=security#device-login-requests")}
          >查看请求</Button
        >
      </Alert.Action>
    </Alert.Root>
  </div>
{/if}
