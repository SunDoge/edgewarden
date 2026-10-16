<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { isLoggedIn } from "$lib/services/api-auth";
  import { errorMessage } from "$lib/services/error-message";
  import { prefillDemoLogin } from "$lib/services/demo-login";
  import { loadVaultSnapshot } from "$lib/services/vault-db";
  import { vault, unlock } from "$lib/stores/vault.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { ShieldCheck, KeyRound, Eye, EyeOff, WifiOff } from "@lucide/svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";

  let email = $state("");
  let showPassword = $state(false);
  let password = $state("");
  let loading = $state(false);
  let error = $state("");
  let hasCache = $state(false);
  let passwordTouched = false;

  onMount(() => {
    if (!isLoggedIn()) {
      goto("/login");
      return;
    }
    if (vault.isUnlocked) {
      goto("/vault");
      return;
    }

    const controller = new AbortController();
    void initializeUnlock(controller.signal);
    return () => controller.abort();
  });

  async function initializeUnlock(signal: AbortSignal) {
    // The cached profile identifies whose vault is being unlocked. Never apply
    // public Demo credentials to another account, including stale local caches.
    const cached = await loadVaultSnapshot();
    if (signal.aborted || !cached) return;
    email = cached.profile.email;
    hasCache = true;
    await prefillDemoLogin(
      () => !passwordTouched && !password && !loading,
      (credentials) => {
        if (email.trim().toLowerCase() === credentials.email.trim().toLowerCase()) {
          password = credentials.password;
        }
      },
      signal,
    );
  }

  async function handleUnlock(e: SubmitEvent) {
    e.preventDefault();
    if (!password) return;

    loading = true;
    error = "";

    try {
      await unlock(password);
      goto("/vault");
    } catch (caught) {
      error = errorMessage(caught, m.ui_unlock_failed_check_your_master_password());
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{m.ui_unlock_vault_edgewarden()}</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
  <div class="absolute right-4 top-4"><ThemeToggle /></div>
  <Card.Root class="w-full max-w-sm">
    <!-- Logo -->
    <Card.Header class="items-center gap-2 text-center">
      <div
        class="mb-4 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground"
      >
        <ShieldCheck class="size-8" />
      </div>
      <Card.Title class="text-2xl">{m.ui_unlock_your_vault()}</Card.Title>
      {#if email}
        <Card.Description>{email}</Card.Description>
      {/if}
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      {#if !hasCache}
        <!-- No cache: must be online to unlock -->
        <Alert.Root
          ><WifiOff /><Alert.Title>{m.ui_online_login_required()}</Alert.Title><Alert.Description
            >{m.ui_log_in_online_once_before_using_offline_unlock()}</Alert.Description
          ></Alert.Root
        >
        <Button class="w-full" onclick={() => goto("/login")}>{m.ui_back_to_login()}</Button>
      {:else}
        <!-- Unlock form -->
        {#if error}
          <Alert.Root variant="destructive"
            ><Alert.Title>{m.ui_unlock_failed()}</Alert.Title><Alert.Description
              >{error}</Alert.Description
            ></Alert.Root
          >
        {/if}

        <form onsubmit={handleUnlock} oninput={() => (passwordTouched = true)}>
          <Field.Group>
            <Field.Field>
              <Field.Label for="password">{m.login_master_password()}</Field.Label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <KeyRound class="size-4" />
                </span>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={m.ui_enter_your_master_password()}
                  bind:value={password}
                  disabled={loading}
                  class="pl-10 pr-10"
                  required
                  autofocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  class="absolute right-1 top-1/2 -translate-y-1/2"
                  onclick={() => (showPassword = !showPassword)}
                  aria-label={showPassword ? m.login_hide_password() : m.login_show_password()}
                >
                  {#if showPassword}
                    <EyeOff class="size-4" />
                  {:else}
                    <Eye class="size-4" />
                  {/if}
                </Button>
              </div>
            </Field.Field>

            <Button type="submit" class="w-full" disabled={loading || !password}>
              {#if loading}
                <Spinner
                  data-icon="inline-start"
                />{m.ui_unlocking()}{:else}{m.login_unlock_vault()}{/if}
            </Button>
          </Field.Group>
        </form>

        <div class="text-center">
          <a href="/login" class="text-sm text-muted-foreground hover:text-primary hover:underline"
            >{m.ui_log_in_with_another_account()}</a
          >
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
