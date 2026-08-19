<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { createRealtimeTicketApi, fetchRevisionDateApi } from "$lib/services/api-vault";
  import { isLoggedIn } from "$lib/services/api-auth";
  import { ensureVaultData, syncVaultData, vault } from "$lib/stores/vault.svelte";
  import { lock, logout } from "$lib/stores/vault.svelte";
  import { VaultRevisionWatcher } from "$lib/services/vault-revision-watcher";
  import { VaultRealtimeClient } from "$lib/services/vault-realtime";
  import {
    CLIENT_PREFERENCES_CHANGED_EVENT,
    clientPreferencesStorageKey,
    loadClientPreferences,
  } from "$lib/services/client-preferences";
  import { SessionTimeout } from "$lib/services/session-timeout";
  import { restoreWebSession } from "$lib/services/rpc";
  import VaultAppNavigation from "$lib/components/vault/VaultAppNavigation.svelte";
  import VaultHeader from "$lib/components/vault/VaultHeader.svelte";

  let { children } = $props();
  let ready = $state(false);
  let preferencesVersion = $state(0);
  let mobileNavigationOpen = $state(false);

  async function handleLogout() {
    await logout();
    await goto("/login");
  }

  onMount(() => {
    let disposed = false;
    const preferencesChanged = () => {
      preferencesVersion += 1;
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === clientPreferencesStorageKey()) preferencesChanged();
    };
    window.addEventListener(CLIENT_PREFERENCES_CHANGED_EVENT, preferencesChanged);
    window.addEventListener("storage", storageChanged);
    void (async () => {
      await restoreWebSession();
      if (!isLoggedIn()) {
        await goto("/login");
        return;
      }
      if (page.url.pathname !== "/vault/unlock" && !vault.isUnlocked) {
        await goto("/vault/unlock");
        if (!disposed) ready = true;
        return;
      }
      if (disposed) return;
      if (page.url.pathname !== "/vault/unlock") {
        try {
          await ensureVaultData();
        } catch {
          // The store exposes its online/offline error state to route content.
        }
      }
      if (disposed) return;
      ready = true;
    })();
    return () => {
      disposed = true;
      window.removeEventListener(CLIENT_PREFERENCES_CHANGED_EVENT, preferencesChanged);
      window.removeEventListener("storage", storageChanged);
    };
  });

  $effect(() => {
    if (!ready || !vault.isUnlocked) return;
    const watcher = new VaultRevisionWatcher({
      readRevision: fetchRevisionDateApi,
      onRevision: async () => {
        if (!vault.isSyncing && vault.isUnlocked) await syncVaultData();
      },
    });
    const realtime = new VaultRealtimeClient({
      getTicket: async () => (await createRealtimeTicketApi()).token,
      onRevision: async () => {
        if (!vault.isSyncing && vault.isUnlocked) await syncVaultData();
      },
    });
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void watcher.check();
    };
    const refreshWhenOnline = () => void watcher.check();
    watcher.start();
    realtime.start();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);
    return () => {
      watcher.stop();
      realtime.stop();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
    };
  });

  $effect(() => {
    if (!ready || !vault.isUnlocked) return;
    preferencesVersion;
    const preferences = loadClientPreferences();
    const timeout = new SessionTimeout({
      timeoutMs: preferences.lockTimeoutMinutes * 60_000,
      onTimeout: async () => {
        if (preferences.sessionTimeoutAction === "logout") {
          await logout();
          await goto("/login?reason=timeout");
        } else {
          lock();
          await goto("/vault/unlock?reason=timeout");
        }
      },
    });
    const activity = () => timeout.reset();
    const visible = () => {
      if (document.visibilityState === "visible") activity();
    };
    for (const event of ["pointerdown", "keydown", "touchstart"] as const)
      window.addEventListener(event, activity, { passive: true });
    document.addEventListener("visibilitychange", visible);
    timeout.reset();
    return () => {
      timeout.stop();
      for (const event of ["pointerdown", "keydown", "touchstart"] as const)
        window.removeEventListener(event, activity);
      document.removeEventListener("visibilitychange", visible);
    };
  });
</script>

{#if ready}
  {#if page.url.pathname === "/vault/unlock"}
    <div class="min-h-screen">{@render children()}</div>
  {:else}
    <div class="flex h-screen flex-col overflow-hidden bg-muted/30">
      <VaultHeader onOpenNavigation={() => (mobileNavigationOpen = true)} onLogout={handleLogout} />
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        <VaultAppNavigation bind:mobileOpen={mobileNavigationOpen} />
        <div class="min-w-0 flex-1 overflow-auto">{@render children()}</div>
      </div>
    </div>
  {/if}
{/if}
