<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { goto } from "$app/navigation";
  import { onDestroy, onMount } from "svelte";
  import { deriveMasterKey } from "$lib/services/crypto";
  import {
    getTurnstileConfigApi,
    isTwoFactorRequiredError,
    login,
    loginWithPasskeyApi,
    twoFactorPasskeyChallengeFromError,
    twoFactorProvidersFromError,
  } from "$lib/services/api-auth";
  import { errorMessage } from "$lib/services/error-message";
  import { prepareVaultNavigation, setMasterKey, setSymmetricKeys } from "$lib/stores/vault.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { assertTwoFactorPasskeyCredential } from "$lib/services/passkeys";
  import {
    Eye,
    EyeOff,
    ShieldAlert,
    ShieldCheck,
    KeyRound,
    Mail,
    Fingerprint,
  } from "@lucide/svelte";
  import TurnstileWidget from "$lib/components/turnstile-widget.svelte";
  import { readDevLoginCredentials } from "$lib/services/dev-login";
  import { prefillDemoLogin } from "$lib/services/demo-login";
  import LanguageSwitcher from "$lib/components/LanguageSwitcher.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import { match } from "ts-pattern";
  import {
    createDeviceLoginRequest,
    exchangeApprovedDeviceLogin,
    pollDeviceLoginRequest,
    type ApprovedDeviceLogin,
    type DeviceLoginRequest,
  } from "$lib/services/auth-requests";
  import { setMemoryAccessToken } from "$lib/services/rpc";

  let email = $state("");
  let password = $state("");
  let showPassword = $state(false);
  let loading = $state(false);
  let error = $state("");
  let twoFactorRequired = $state(false);
  let twoFactorToken = $state("");
  let twoFactorProvider = $state<"0" | "3" | "8">("0");
  let availableTwoFactorProviders = $state<string[]>([]);
  let passkeyUnlock = $state<{
    email: string;
    iterations: number;
    profileKey: string;
  } | null>(null);
  let passkeyPassword = $state("");
  let twoFactorPasskeyChallenge = $state<{
    options: unknown;
    token: string;
  } | null>(null);
  let turnstileEnabled = $state(false);
  let turnstileSiteKey = $state<string | null>(null);
  let turnstileToken = $state("");
  let turnstileLoading = $state(true);
  let turnstileWidget = $state<{ reset(): void } | null>(null);
  let deviceLoginRequest = $state<DeviceLoginRequest | null>(null);
  let approvedDeviceLogin = $state<ApprovedDeviceLogin | null>(null);
  let deviceLoginGeneration = 0;
  let credentialsTouched = false;

  onMount(() => {
    void initializeLogin();
    const controller = new AbortController();
    void prefillDemoLogin(
      () =>
        !credentialsTouched &&
        !email &&
        !password &&
        !loading &&
        !deviceLoginRequest &&
        !passkeyUnlock,
      (credentials) => {
        email = credentials.email;
        password = credentials.password;
      },
      controller.signal,
    );
    return () => controller.abort();
  });

  onDestroy(() => {
    deviceLoginGeneration += 1;
  });

  async function initializeLogin() {
    try {
      const config = await getTurnstileConfigApi();
      turnstileEnabled = config.enabled;
      turnstileSiteKey = config.siteKey;
      if (config.enabled && !config.siteKey) error = m.login_turnstile_missing();
    } catch {
      error = m.login_config_error();
      return;
    } finally {
      turnstileLoading = false;
    }

    const credentials = import.meta.env.DEV ? readDevLoginCredentials(true, import.meta.env) : null;
    if (credentials && !turnstileEnabled) {
      email = credentials.email;
      password = credentials.password;
      await submitPasswordLogin();
    }
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    await submitPasswordLogin();
  }

  async function submitPasswordLogin() {
    if (approvedDeviceLogin) {
      await completeApprovedDeviceLogin();
      return;
    }
    if (!email || !password) {
      error = m.login_credentials_required();
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      error = m.login_verify_required();
      return;
    }

    cancelDeviceLogin();
    loading = true;
    error = "";

    try {
      const { masterKey } = await login(
        email,
        password,
        twoFactorRequired ? { token: twoFactorToken, provider: twoFactorProvider } : undefined,
        turnstileToken || undefined,
      );
      setMasterKey(masterKey);
      await prepareVaultNavigation();
      await goto("/vault");
    } catch (caught) {
      if (isTwoFactorRequiredError(caught)) {
        twoFactorRequired = true;
        twoFactorPasskeyChallenge = twoFactorPasskeyChallengeFromError(caught);
        availableTwoFactorProviders = twoFactorProvidersFromError(caught);
        if (!availableTwoFactorProviders.includes("0") && availableTwoFactorProviders.includes("3"))
          twoFactorProvider = "3";
        error = m.login_authenticator_required();
      } else error = errorMessage(caught, m.login_failed_credentials());
      if (turnstileEnabled) turnstileWidget?.reset();
    } finally {
      loading = false;
    }
  }

  async function completeApprovedDeviceLogin() {
    if (!approvedDeviceLogin || !twoFactorToken.trim()) {
      error = m.login_code_required();
      return;
    }
    loading = true;
    error = "";
    const generation = deviceLoginGeneration;
    try {
      const result = await exchangeApprovedDeviceLogin(approvedDeviceLogin, {
        token: twoFactorToken,
        provider: twoFactorProvider,
      });
      if (generation !== deviceLoginGeneration) return;
      setMemoryAccessToken(result.accessToken);
      setSymmetricKeys(result.encKey, result.macKey);
      approvedDeviceLogin = null;
      await prepareVaultNavigation();
      await goto("/vault");
    } catch (caught) {
      if (generation === deviceLoginGeneration)
        error = errorMessage(caught, m.login_two_factor_failed());
    } finally {
      if (generation === deviceLoginGeneration) loading = false;
    }
  }

  async function completeTwoFactorPasskey() {
    if (!twoFactorPasskeyChallenge) return;
    loading = true;
    error = "";
    const generation = deviceLoginGeneration;
    try {
      const assertion = await assertTwoFactorPasskeyCredential(twoFactorPasskeyChallenge);
      if (generation !== deviceLoginGeneration) return;
      if (approvedDeviceLogin) {
        const result = await exchangeApprovedDeviceLogin(approvedDeviceLogin, {
          provider: "7",
          token: JSON.stringify(assertion),
        });
        if (generation !== deviceLoginGeneration) return;
        setMemoryAccessToken(result.accessToken);
        setSymmetricKeys(result.encKey, result.macKey);
        approvedDeviceLogin = null;
        await prepareVaultNavigation();
        await goto("/vault");
        return;
      }
      const { masterKey } = await login(
        email,
        password,
        { provider: "7", token: JSON.stringify(assertion) },
        turnstileToken || undefined,
      );
      setMasterKey(masterKey);
      await prepareVaultNavigation();
      await goto("/vault");
    } catch (value) {
      if (generation === deviceLoginGeneration) {
        error = value instanceof Error ? value.message : m.login_security_key_failed();
        if (turnstileEnabled) turnstileWidget?.reset();
      }
    } finally {
      if (generation === deviceLoginGeneration) loading = false;
    }
  }

  async function handlePasskeyLogin() {
    cancelDeviceLogin();
    loading = true;
    error = "";
    try {
      const result = await loginWithPasskeyApi();
      if (result.symEncKey && result.symMacKey) {
        setSymmetricKeys(result.symEncKey, result.symMacKey);
        await prepareVaultNavigation();
        await goto("/vault");
        return;
      }
      if (!result.masterPasswordUnlock?.email || !result.masterPasswordUnlock.profileKey)
        throw new Error(m.login_passkey_no_unlock());
      passkeyUnlock = result.masterPasswordUnlock;
    } catch (err) {
      error = err instanceof Error ? err.message : m.login_passkey_failed();
    } finally {
      loading = false;
    }
  }

  async function completePasskeyUnlock() {
    if (!passkeyUnlock || !passkeyPassword) return;
    loading = true;
    try {
      setMasterKey(
        await deriveMasterKey(passkeyPassword, passkeyUnlock.email, passkeyUnlock.iterations),
      );
      await prepareVaultNavigation();
      await goto("/vault");
    } catch (err) {
      error = err instanceof Error ? err.message : m.login_password_incorrect();
    } finally {
      loading = false;
    }
  }

  async function startDeviceLogin() {
    if (deviceLoginRequest) return;
    if (!email.trim()) {
      error = m.login_email_required();
      return;
    }
    loading = true;
    error = "";
    const generation = ++deviceLoginGeneration;
    try {
      const request = await createDeviceLoginRequest(email);
      if (generation !== deviceLoginGeneration) return;
      deviceLoginRequest = request;
      loading = false;
      while (generation === deviceLoginGeneration && deviceLoginRequest?.id === request.id) {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        if (generation !== deviceLoginGeneration || deviceLoginRequest?.id !== request.id) break;
        const result = await pollDeviceLoginRequest(request);
        if (generation !== deviceLoginGeneration) return;
        if (result === "pending") continue;
        if (result === "declined") {
          deviceLoginRequest = null;
          error = m.login_device_rejected();
          return;
        }
        try {
          const exchanged = await exchangeApprovedDeviceLogin(result);
          if (generation !== deviceLoginGeneration) return;
          setMemoryAccessToken(exchanged.accessToken);
          setSymmetricKeys(exchanged.encKey, exchanged.macKey);
          deviceLoginRequest = null;
          await prepareVaultNavigation();
          await goto("/vault");
          return;
        } catch (caught) {
          if (!isTwoFactorRequiredError(caught)) throw caught;
          approvedDeviceLogin = result;
          deviceLoginRequest = null;
          twoFactorRequired = true;
          twoFactorPasskeyChallenge = twoFactorPasskeyChallengeFromError(caught);
          availableTwoFactorProviders = twoFactorProvidersFromError(caught);
          if (
            !availableTwoFactorProviders.includes("0") &&
            availableTwoFactorProviders.includes("3")
          )
            twoFactorProvider = "3";
          error = m.login_device_two_factor();
          return;
        }
      }
    } catch (caught) {
      if (generation === deviceLoginGeneration) {
        deviceLoginRequest = null;
        error = errorMessage(caught, m.login_device_failed());
      }
    } finally {
      if (generation === deviceLoginGeneration) loading = false;
    }
  }

  function cancelDeviceLogin() {
    const wasApproved = approvedDeviceLogin !== null;
    deviceLoginGeneration += 1;
    deviceLoginRequest = null;
    approvedDeviceLogin = null;
    if (wasApproved) {
      twoFactorRequired = false;
      twoFactorToken = "";
      twoFactorPasskeyChallenge = null;
      availableTwoFactorProviders = [];
      error = "";
    }
  }
</script>

<svelte:head>
  <title>{m.login_page_title()}</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
  <div class="absolute right-4 top-4 flex items-center gap-1">
    <LanguageSwitcher /><ThemeToggle />
  </div>
  <Card.Root class="w-full max-w-md shadow-lg">
    <Card.Header class="items-center gap-2 text-center">
      <div
        class="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"
      >
        <KeyRound class="size-6" />
      </div>
      <Card.Title class="text-2xl font-bold tracking-tight">{m.login_title()}</Card.Title>
      <Card.Description>{m.login_description()}</Card.Description>
    </Card.Header>

    <Card.Content>
      {#if error}
        <Alert.Root variant="destructive" class="mb-4"
          ><ShieldAlert /><Alert.Title>{m.login_error_title()}</Alert.Title><Alert.Description
            >{error}</Alert.Description
          ></Alert.Root
        >
      {/if}

      <form onsubmit={handleSubmit} oninput={() => (credentialsTouched = true)}>
        <Field.Group>
          <Field.Field>
            <Field.Label for="email">{m.login_email()}</Field.Label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <Mail class="size-4" />
              </span>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                bind:value={email}
                disabled={loading}
                class="pl-10"
                required
              />
            </div>
          </Field.Field>

          {#if twoFactorRequired}
            {#if approvedDeviceLogin}
              <Field.Description>
                {m.login_approved_description()}
              </Field.Description>
            {/if}
            <Field.Field
              ><Field.Label for="two-factor-token"
                >{match(twoFactorProvider)
                  .with("0", () => m.login_code())
                  .with("3", () => "YubiKey OTP")
                  .otherwise(() => m.login_recovery_code())}</Field.Label
              ><ToggleGroup.Root
                type="single"
                size="sm"
                variant="outline"
                value={twoFactorProvider}
                onValueChange={(value) => {
                  if (value) {
                    twoFactorProvider = value as typeof twoFactorProvider;
                    twoFactorToken = "";
                  }
                }}
                ><ToggleGroup.Item value="0">{m.login_authenticator()}</ToggleGroup.Item
                >{#if availableTwoFactorProviders.includes("3")}<ToggleGroup.Item value="3"
                    >YubiKey</ToggleGroup.Item
                  >{/if}<ToggleGroup.Item value="8">{m.login_recovery_code()}</ToggleGroup.Item
                ></ToggleGroup.Root
              ><Input
                id="two-factor-token"
                bind:value={twoFactorToken}
                inputmode={twoFactorProvider === "0" ? "numeric" : "text"}
                autocomplete="one-time-code"
                maxlength={64}
                required
              /></Field.Field
            >
            {#if twoFactorPasskeyChallenge}<Button
                type="button"
                variant="outline"
                class="w-full"
                onclick={completeTwoFactorPasskey}
                disabled={loading || (turnstileEnabled && !turnstileToken)}
                ><Fingerprint data-icon="inline-start" />{m.login_security_key()}</Button
              >{/if}
            {#if approvedDeviceLogin}
              <Button
                type="button"
                variant="ghost"
                class="w-full"
                onclick={cancelDeviceLogin}
                disabled={loading}>{m.login_cancel_device()}</Button
              >
            {/if}
          {/if}

          {#if !approvedDeviceLogin}
            <Field.Field>
              <Field.Label for="password">{m.login_master_password()}</Field.Label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <KeyRound class="size-4" />
                </span>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••••"
                  bind:value={password}
                  disabled={loading}
                  class="pl-10 pr-10"
                  required
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
                    <EyeOff data-icon />
                  {:else}
                    <Eye data-icon />
                  {/if}
                </Button>
              </div>
            </Field.Field>
          {/if}

          {#if turnstileEnabled && turnstileSiteKey && !approvedDeviceLogin}
            <TurnstileWidget
              bind:this={turnstileWidget}
              siteKey={turnstileSiteKey}
              onToken={(token) => {
                turnstileToken = token;
              }}
              onError={() => {
                error = m.login_turnstile_failed();
              }}
            />
          {/if}

          <Button
            type="submit"
            class="w-full mt-2"
            disabled={loading ||
              turnstileLoading ||
              (!approvedDeviceLogin && turnstileEnabled && !turnstileToken)}
          >
            {#if loading}
              <Spinner data-icon="inline-start" />
              {m.login_decrypting()}
            {:else}
              {approvedDeviceLogin ? m.login_complete_two_factor() : m.login_unlock()}
            {/if}
          </Button>
        </Field.Group>
      </form>

      <div class="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <Separator class="flex-1" />{m.login_or()}<Separator class="flex-1" />
      </div>
      <Button
        type="button"
        variant="outline"
        class="w-full"
        onclick={handlePasskeyLogin}
        disabled={loading}><Fingerprint data-icon="inline-start" />{m.login_passkey()}</Button
      >
      <Button
        type="button"
        variant="outline"
        class="mt-2 w-full"
        onclick={startDeviceLogin}
        disabled={loading || !!deviceLoginRequest || !!approvedDeviceLogin || !email.trim()}
        ><ShieldCheck data-icon="inline-start" />{m.login_device()}</Button
      >

      {#if deviceLoginRequest}
        <div class="mt-4 rounded-md border p-4 text-center">
          <p class="text-sm font-medium">{m.login_approve_elsewhere()}</p>
          <p class="mt-1 text-xs text-muted-foreground">{m.login_compare_phrase()}</p>
          <code class="mt-3 block break-words text-sm font-semibold">
            {deviceLoginRequest.fingerprintPhrase}
          </code>
          <div class="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner class="size-3.5" />{m.login_wait_approval()}
          </div>
          <Button class="mt-3" type="button" size="sm" variant="ghost" onclick={cancelDeviceLogin}
            >{m.login_cancel()}</Button
          >
        </div>
      {/if}

      {#if passkeyUnlock}
        <form
          class="mt-4 rounded-md border p-3"
          onsubmit={(event) => {
            event.preventDefault();
            void completePasskeyUnlock();
          }}
        >
          <Field.Group
            ><Field.Description>{m.login_passkey_unlock_description()}</Field.Description
            ><Field.Field
              ><Field.Label for="passkey-password">{m.login_master_password()}</Field.Label><Input
                id="passkey-password"
                type="password"
                bind:value={passkeyPassword}
                autocomplete="current-password"
                required
              /></Field.Field
            ><Button class="w-full" type="submit" disabled={loading}
              >{m.login_unlock_vault()}</Button
            ></Field.Group
          >
        </form>
      {/if}
    </Card.Content>

    <Card.Footer class="flex flex-col items-center border-t py-4 gap-2">
      <a href="/recover-2fa" class="text-sm text-primary font-medium hover:underline"
        >{m.login_recover()}</a
      >
      <p class="text-sm text-muted-foreground">
        {m.login_no_account()}
        <a href="/register" class="text-primary font-medium hover:underline">
          {m.login_register()}
        </a>
      </p>
    </Card.Footer>
  </Card.Root>
</div>
