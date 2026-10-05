<script lang="ts">
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

  onMount(() => {
    void initializeLogin();
  });

  onDestroy(() => {
    deviceLoginGeneration += 1;
  });

  async function initializeLogin() {
    try {
      const config = await getTurnstileConfigApi();
      turnstileEnabled = config.enabled;
      turnstileSiteKey = config.siteKey;
      if (config.enabled && !config.siteKey) error = "Turnstile 已启用，但服务器没有配置站点密钥。";
    } catch {
      error = "无法加载登录安全配置。";
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
      error = "请输入电子邮件和主密码。";
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      error = "请先完成人机验证。";
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
        error = "请输入身份验证器验证码或恢复代码。";
      } else error = errorMessage(caught, "登录失败，请检查您的凭据。");
      if (turnstileEnabled) turnstileWidget?.reset();
    } finally {
      loading = false;
    }
  }

  async function completeApprovedDeviceLogin() {
    if (!approvedDeviceLogin || !twoFactorToken.trim()) {
      error = "请输入两步验证码或恢复代码。";
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
        error = errorMessage(caught, "两步验证失败，请重试。");
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
        error = value instanceof Error ? value.message : "安全密钥验证失败";
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
        throw new Error("这把通行密钥无法解锁保险库");
      passkeyUnlock = result.masterPasswordUnlock;
    } catch (err) {
      error = err instanceof Error ? err.message : "通行密钥登录失败";
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
      error = err instanceof Error ? err.message : "主密码不正确";
    } finally {
      loading = false;
    }
  }

  async function startDeviceLogin() {
    if (deviceLoginRequest) return;
    if (!email.trim()) {
      error = "请先输入电子邮件地址。";
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
          error = "设备登录请求已被拒绝。";
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
          error = "设备已批准，请完成账户的两步验证。";
          return;
        }
      }
    } catch (caught) {
      if (generation === deviceLoginGeneration) {
        deviceLoginRequest = null;
        error = errorMessage(caught, "设备批准登录失败，请重新发起请求。");
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
  <title>登录 - Edgewarden</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
  <div class="absolute right-4 top-4"><ThemeToggle /></div>
  <Card.Root class="w-full max-w-md shadow-lg">
    <Card.Header class="items-center gap-2 text-center">
      <div
        class="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"
      >
        <KeyRound class="size-6" />
      </div>
      <Card.Title class="text-2xl font-bold tracking-tight">登录到 Edgewarden</Card.Title>
      <Card.Description>自托管的零知识密码库管理器</Card.Description>
    </Card.Header>

    <Card.Content>
      {#if error}
        <Alert.Root variant="destructive" class="mb-4"
          ><ShieldAlert /><Alert.Title>登录失败</Alert.Title><Alert.Description
            >{error}</Alert.Description
          ></Alert.Root
        >
      {/if}

      <form onsubmit={handleSubmit}>
        <Field.Group>
          <Field.Field>
            <Field.Label for="email">电子邮件地址</Field.Label>
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
                已由另一台设备批准。账户的两步验证仍需单独完成，成功前批准请求不会被消费。
              </Field.Description>
            {/if}
            <Field.Field
              ><Field.Label for="two-factor-token"
                >{match(twoFactorProvider)
                  .with("0", () => "两步验证码")
                  .with("3", () => "YubiKey OTP")
                  .otherwise(() => "恢复代码")}</Field.Label
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
                ><ToggleGroup.Item value="0">身份验证器</ToggleGroup.Item
                >{#if availableTwoFactorProviders.includes("3")}<ToggleGroup.Item value="3"
                    >YubiKey</ToggleGroup.Item
                  >{/if}<ToggleGroup.Item value="8">恢复代码</ToggleGroup.Item></ToggleGroup.Root
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
                ><Fingerprint data-icon="inline-start" />使用安全密钥验证</Button
              >{/if}
            {#if approvedDeviceLogin}
              <Button
                type="button"
                variant="ghost"
                class="w-full"
                onclick={cancelDeviceLogin}
                disabled={loading}>取消设备登录</Button
              >
            {/if}
          {/if}

          {#if !approvedDeviceLogin}
            <Field.Field>
              <Field.Label for="password">主密码</Field.Label>
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
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
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
                error = "人机验证加载失败，请刷新后重试。";
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
              正在进行安全解密...
            {:else}
              {approvedDeviceLogin ? "完成两步验证" : "解锁密码库"}
            {/if}
          </Button>
        </Field.Group>
      </form>

      <div class="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <Separator class="flex-1" />或<Separator class="flex-1" />
      </div>
      <Button
        type="button"
        variant="outline"
        class="w-full"
        onclick={handlePasskeyLogin}
        disabled={loading}><Fingerprint data-icon="inline-start" />使用通行密钥登录</Button
      >
      <Button
        type="button"
        variant="outline"
        class="mt-2 w-full"
        onclick={startDeviceLogin}
        disabled={loading || !!deviceLoginRequest || !!approvedDeviceLogin || !email.trim()}
        ><ShieldCheck data-icon="inline-start" />使用设备批准登录</Button
      >

      {#if deviceLoginRequest}
        <div class="mt-4 rounded-md border p-4 text-center">
          <p class="text-sm font-medium">在已登录的设备上批准此请求</p>
          <p class="mt-1 text-xs text-muted-foreground">请确认两台设备显示相同的验证短语：</p>
          <code class="mt-3 block break-words text-sm font-semibold">
            {deviceLoginRequest.fingerprintPhrase}
          </code>
          <div class="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner class="size-3.5" />等待批准，最长 15 分钟
          </div>
          <Button class="mt-3" type="button" size="sm" variant="ghost" onclick={cancelDeviceLogin}
            >取消</Button
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
            ><Field.Description>这把通行密钥仅用于登录。请输入主密码解锁保险库。</Field.Description
            ><Field.Field
              ><Field.Label for="passkey-password">主密码</Field.Label><Input
                id="passkey-password"
                type="password"
                bind:value={passkeyPassword}
                autocomplete="current-password"
                required
              /></Field.Field
            ><Button class="w-full" type="submit" disabled={loading}>解锁保险库</Button
            ></Field.Group
          >
        </form>
      {/if}
    </Card.Content>

    <Card.Footer class="flex flex-col items-center border-t py-4 gap-2">
      <a href="/recover-2fa" class="text-sm text-primary font-medium hover:underline"
        >无法使用两步验证？</a
      >
      <p class="text-sm text-muted-foreground">
        还没有账号？
        <a href="/register" class="text-primary font-medium hover:underline"> 立即注册 </a>
      </p>
    </Card.Footer>
  </Card.Root>
</div>
