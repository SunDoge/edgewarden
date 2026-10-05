<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import {
    encryptVaultKeyForAuthRequest,
    listPendingAuthRequestsApi,
    respondToAuthRequestApi,
    type AuthRequest,
  } from "$lib/services/auth-requests";
  import { vault } from "$lib/stores/vault.svelte";
  import { RefreshCw, ShieldCheck } from "@lucide/svelte";

  let {
    email,
    onMessage,
    onError,
  }: {
    email: string;
    onMessage: (message: string) => void;
    onError: (error: unknown) => void;
  } = $props();

  let requests = $state<AuthRequest[]>([]);
  let busy = $state("");
  let refreshing = $state(false);
  let showingRefresh = $state(false);
  let refreshToken = 0;

  async function refresh({ silent = false }: { silent?: boolean } = {}) {
    if (refreshing || busy) return;
    const token = ++refreshToken;
    refreshing = true;
    showingRefresh = !silent;
    try {
      const pending = await listPendingAuthRequestsApi(email);
      if (token === refreshToken && !busy) requests = pending;
    } catch (error) {
      if (!silent) onError(error);
    } finally {
      if (token === refreshToken) {
        refreshing = false;
        showingRefresh = false;
      }
    }
  }

  async function respond(request: AuthRequest, approved: boolean) {
    // An older refresh must not put this request back after the response succeeds.
    refreshToken += 1;
    refreshing = false;
    showingRefresh = false;
    busy = request.id;
    try {
      let key: string | undefined;
      if (approved) {
        if (!vault.symEncKey || !vault.symMacKey) {
          throw new Error("保险库密钥不可用，请重新解锁");
        }
        key = await encryptVaultKeyForAuthRequest(
          request.publicKey,
          vault.symEncKey,
          vault.symMacKey,
        );
      }
      await respondToAuthRequestApi(request.id, approved, key);
      requests = requests.filter((item) => item.id !== request.id);
      onMessage(approved ? "已批准设备登录" : "已拒绝设备登录");
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }

  onMount(() => {
    void refresh();

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh({ silent: true });
    };
    const interval = window.setInterval(refreshWhenVisible, 5_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  });
</script>

<Card.Root id="device-login-requests">
  <Card.Header class="flex-row items-start justify-between">
    <div>
      <Card.Title>待审批设备登录</Card.Title>
      <Card.Description>批准前请在请求设备上核对验证短语和设备信息。</Card.Description>
    </div>
    <Button variant="outline" size="sm" onclick={() => refresh()} disabled={refreshing || !!busy}>
      <RefreshCw class={showingRefresh ? "animate-spin" : ""} />刷新
    </Button>
  </Card.Header>
  <Card.Content class="flex flex-col gap-3">
    {#each requests as request (request.id)}
      <div
        class="flex flex-col gap-3 rounded-md border p-3 md:flex-row md:items-center md:justify-between"
      >
        <div class="min-w-0">
          <div class="font-medium">{request.requestDeviceType}</div>
          <div class="truncate text-xs text-muted-foreground">
            {request.requestDeviceIdentifier}
          </div>
          <div class="text-xs text-muted-foreground">
            {new Date(request.creationDate).toLocaleString()}{request.requestIpAddress
              ? ` · ${request.requestIpAddress}`
              : ""}
          </div>
          <div class="mt-2 text-xs text-muted-foreground">验证短语</div>
          <code class="mt-1 block break-words text-sm font-medium">
            {request.fingerprintPhrase || "验证短语不可用"}
          </code>
        </div>
        <div class="flex shrink-0 gap-2">
          <Button size="sm" onclick={() => respond(request, true)} disabled={!!busy}
            ><ShieldCheck />批准</Button
          >
          <Button
            size="sm"
            variant="destructive"
            onclick={() => respond(request, false)}
            disabled={!!busy}>拒绝</Button
          >
        </div>
      </div>
    {:else}
      <p class="py-4 text-sm text-muted-foreground">没有待审批的设备登录。</p>
    {/each}
  </Card.Content>
</Card.Root>
