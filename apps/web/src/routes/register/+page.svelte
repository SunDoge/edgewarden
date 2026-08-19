<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { getRegistrationConfigApi, register } from "$lib/services/api-auth";
  import { errorMessage } from "$lib/services/error-message";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import TurnstileWidget from "$lib/components/turnstile-widget.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import { Eye, EyeOff, ShieldAlert, KeyRound, Mail, User, CheckCircle2 } from "@lucide/svelte";

  let email = $state("");
  let name = $state("");
  let password = $state("");
  let confirmPassword = $state("");
  let hint = $state("");
  let iterations = $state(600000);
  let inviteCode = $state("");
  let adminPassword = $state("");
  let configLoading = $state(true);
  let signupsAllowed = $state(false);
  let invitationsAllowed = $state(false);
  let bootstrapRequired = $state(false);
  let adminPasswordConfigured = $state(false);
  let turnstileEnabled = $state(false);
  let turnstileSiteKey = $state<string | null>(null);
  let turnstileToken = $state("");
  let turnstileWidget = $state<{ reset(): void } | null>(null);

  onMount(async () => {
    inviteCode = new URLSearchParams(location.search).get("invite")?.trim() ?? "";
    try {
      const config = await getRegistrationConfigApi();
      signupsAllowed = config.signupsAllowed;
      invitationsAllowed = config.invitationsAllowed;
      bootstrapRequired = config.bootstrapRequired;
      adminPasswordConfigured = config.adminPasswordConfigured;
      turnstileEnabled = config.turnstileEnabled;
      turnstileSiteKey = config.turnstileSiteKey;
      if (config.turnstileEnabled && !config.turnstileSiteKey) {
        error = "Turnstile 已启用，但服务器没有配置站点密钥。";
      }
    } catch (caught) {
      error = errorMessage(caught, "无法加载注册配置。");
    } finally {
      configLoading = false;
    }
  });

  let showPassword = $state(false);
  let showConfirmPassword = $state(false);
  let loading = $state(false);
  let error = $state("");
  let success = $state(false);

  let isPasswordMatch = $derived(password === confirmPassword);
  let isPasswordLengthValid = $derived(password.length >= 8);
  let registrationAvailable = $derived(
    bootstrapRequired || signupsAllowed || (invitationsAllowed && Boolean(inviteCode.trim())),
  );

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!email || !password || !confirmPassword) {
      error = "请填写所有必填字段。";
      return;
    }
    if (bootstrapRequired && !adminPassword) {
      error = "首次创建管理员账号需要部署管理员密码。";
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      error = "请先完成人机验证。";
      return;
    }

    if (!isPasswordMatch) {
      error = "两次输入的密码不一致。";
      return;
    }

    if (!isPasswordLengthValid) {
      error = "主密码长度必须至少为 8 位。";
      return;
    }

    if (iterations < 100000) {
      error = "为了您的安全，KDF 迭代次数不能低于 100,000 次。";
      return;
    }

    loading = true;
    error = "";

    try {
      await register(
        email,
        password,
        name,
        hint,
        iterations,
        inviteCode,
        adminPassword,
        turnstileToken || undefined,
      );
      success = true;
      setTimeout(() => {
        goto("/login");
      }, 2000);
    } catch (caught) {
      error = errorMessage(caught, "注册失败，请稍后重试。");
      if (turnstileEnabled) turnstileWidget?.reset();
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>注册账号 - Edgewarden</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
  <div class="absolute right-4 top-4"><ThemeToggle /></div>
  <Card.Root class="w-full max-w-lg shadow-lg">
    <Card.Header class="items-center gap-2 text-center">
      <div
        class="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"
      >
        <User class="size-6" />
      </div>
      <Card.Title class="text-2xl font-bold tracking-tight">创建您的 Edgewarden 账号</Card.Title>
      <Card.Description>请记住您设置的主密码，它是解密您所有密码的唯一钥匙。</Card.Description>
    </Card.Header>

    <Card.Content>
      {#if success}
        <Empty.Root
          ><Empty.Header
            ><Empty.Media variant="icon"><CheckCircle2 /></Empty.Media><Empty.Title
              >注册成功</Empty.Title
            ><Empty.Description>您的零知识密码库已初始化，正在跳转到登录页面。</Empty.Description
            ></Empty.Header
          ><Empty.Content><Spinner /></Empty.Content></Empty.Root
        >
      {:else}
        {#if !configLoading && bootstrapRequired && !adminPasswordConfigured}
          <Alert.Root variant="destructive" class="mb-4"
            ><Alert.Title>部署配置不完整</Alert.Title><Alert.Description
              >服务端尚未配置 BOOTSTRAP_SECRET，无法安全创建首个管理员账号。</Alert.Description
            ></Alert.Root
          >
        {:else if !configLoading && !registrationAvailable}
          <Alert.Root class="mb-4"
            ><Alert.Title>公开注册已关闭</Alert.Title><Alert.Description
              >请填写有效邀请码，或联系管理员开启注册。</Alert.Description
            ></Alert.Root
          >
        {/if}
        {#if error}
          <Alert.Root variant="destructive" class="mb-4"
            ><ShieldAlert /><Alert.Title>注册失败</Alert.Title><Alert.Description
              >{error}</Alert.Description
            ></Alert.Root
          >
        {/if}

        <form onsubmit={handleSubmit}>
          <Field.Group>
            {#if bootstrapRequired}
              <Field.Field
                ><Field.Label for="admin-password">部署管理员密码 *</Field.Label><Input
                  id="admin-password"
                  type="password"
                  bind:value={adminPassword}
                  autocomplete="current-password"
                  disabled={loading}
                  required
                /></Field.Field
              >
            {:else if invitationsAllowed}
              <Field.Field
                ><Field.Label for="invite-code">邀请码（可选）</Field.Label><Input
                  id="invite-code"
                  bind:value={inviteCode}
                  autocomplete="off"
                  disabled={loading}
                /></Field.Field
              >
            {/if}
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field.Field>
                <Field.Label for="email">电子邮件地址 *</Field.Label>
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

              <Field.Field>
                <Field.Label for="name">您的姓名（可选）</Field.Label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <User class="size-4" />
                  </span>
                  <Input
                    id="name"
                    type="text"
                    placeholder="张三"
                    bind:value={name}
                    disabled={loading}
                    class="pl-10"
                  />
                </div>
              </Field.Field>
            </div>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field.Field data-invalid={password.length > 0 && !isPasswordLengthValid}>
                <Field.Label for="password">主密码 *</Field.Label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <KeyRound class="size-4" />
                  </span>
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="至少 8 位字符"
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
                      <EyeOff class="size-4" />
                    {:else}
                      <Eye class="size-4" />
                    {/if}
                  </Button>
                </div>
                <Field.Description>至少 8 位字符。</Field.Description>
              </Field.Field>

              <Field.Field data-invalid={confirmPassword.length > 0 && !isPasswordMatch}>
                <Field.Label for="confirmPassword">确认主密码 *</Field.Label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <KeyRound class="size-4" />
                  </span>
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="请再次输入"
                    bind:value={confirmPassword}
                    disabled={loading}
                    class="pl-10 pr-10"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    class="absolute right-1 top-1/2 -translate-y-1/2"
                    onclick={() => (showConfirmPassword = !showConfirmPassword)}
                    aria-label={showConfirmPassword ? "隐藏密码" : "显示密码"}
                  >
                    {#if showConfirmPassword}
                      <EyeOff class="size-4" />
                    {:else}
                      <Eye class="size-4" />
                    {/if}
                  </Button>
                </div>
                {#if confirmPassword.length > 0 && !isPasswordMatch}<Field.Error
                    >两次输入的密码不一致。</Field.Error
                  >{/if}
              </Field.Field>
            </div>

            <Field.Field>
              <Field.Label for="hint">密码提示问题（可选）</Field.Label>
              <Input
                id="hint"
                type="text"
                placeholder="例如：我最喜欢的书的作者"
                bind:value={hint}
                disabled={loading}
              />
              <Field.Description
                >如果忘记密码，提示可帮助回忆；服务端仅存储提示文本。</Field.Description
              >
            </Field.Field>

            <Separator />
            <Field.Field>
              <Field.Label for="iterations">PBKDF2 迭代次数</Field.Label>
              <Input
                id="iterations"
                type="number"
                bind:value={iterations}
                min="100000"
                disabled={loading}
              />
              <Field.Description>
                更高的次数意味着更强的防暴力破解能力，但设备导出密钥的时间会随之变长。推荐值为
                600,000。
              </Field.Description>
            </Field.Field>

            {#if turnstileEnabled && turnstileSiteKey}
              <TurnstileWidget
                bind:this={turnstileWidget}
                siteKey={turnstileSiteKey}
                action="register"
                onToken={(token) => {
                  turnstileToken = token;
                }}
                onError={() => {
                  error = "人机验证加载失败，请重试。";
                }}
              />
            {/if}

            <Button
              type="submit"
              class="w-full mt-2"
              disabled={loading ||
                configLoading ||
                !registrationAvailable ||
                (bootstrapRequired && !adminPasswordConfigured) ||
                (turnstileEnabled && !turnstileToken)}
            >
              {#if loading}
                <Spinner data-icon="inline-start" />
                正在本地派生加密密钥...
              {:else}
                创建我的主密码库
              {/if}
            </Button>
          </Field.Group>
        </form>
      {/if}
    </Card.Content>

    <Card.Footer class="flex flex-col items-center gap-2 border-t py-4">
      <p class="text-sm text-muted-foreground">
        已有 Edgewarden 账号？
        <a href="/login" class="text-primary font-medium hover:underline"> 立即登录 </a>
      </p>
    </Card.Footer>
  </Card.Root>
</div>
