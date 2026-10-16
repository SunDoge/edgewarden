<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

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
    const params = new URLSearchParams(location.search);
    inviteCode = params.get("invite")?.trim() ?? "";
    // Prefill once; query parameters never authorize use of an invitation.
    if (inviteCode && !email) email = params.get("email")?.trim() ?? "";
    try {
      const config = await getRegistrationConfigApi();
      signupsAllowed = config.signupsAllowed;
      invitationsAllowed = config.invitationsAllowed;
      bootstrapRequired = config.bootstrapRequired;
      adminPasswordConfigured = config.adminPasswordConfigured;
      turnstileEnabled = config.turnstileEnabled;
      turnstileSiteKey = config.turnstileSiteKey;
      if (config.turnstileEnabled && !config.turnstileSiteKey) {
        error = m.login_turnstile_missing();
      }
    } catch (caught) {
      error = errorMessage(caught, m.ui_unable_to_load_registration_settings());
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
      error = m.ui_fill_in_all_required_fields();
      return;
    }
    if (bootstrapRequired && !adminPassword) {
      error = m.ui_the_first_administrator_requires_the_deployment_password();
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      error = m.login_verify_required();
      return;
    }

    if (!isPasswordMatch) {
      error = m.ui_the_passwords_do_not_match();
      return;
    }

    if (!isPasswordLengthValid) {
      error = m.ui_your_master_password_must_contain_at_least_8_characters();
      return;
    }

    if (iterations < 100000) {
      error = m.ui_for_your_security_kdf_iterations_must_be_at_least_100_000();
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
      error = errorMessage(caught, m.ui_registration_failed_please_try_again_later());
      if (turnstileEnabled) turnstileWidget?.reset();
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{m.ui_create_account_edgewarden()}</title>
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
      <Card.Title class="text-2xl font-bold tracking-tight"
        >{m.ui_create_your_edgewarden_account()}</Card.Title
      >
      <Card.Description
        >{m.ui_remember_your_master_password_you_need_it_to_decrypt_your_vault()}</Card.Description
      >
    </Card.Header>

    <Card.Content>
      {#if success}
        <Empty.Root
          ><Empty.Header
            ><Empty.Media variant="icon"><CheckCircle2 /></Empty.Media><Empty.Title
              >{m.ui_account_created()}</Empty.Title
            ><Empty.Description
              >{m.ui_your_encrypted_vault_is_ready_redirecting_to_login()}</Empty.Description
            ></Empty.Header
          ><Empty.Content><Spinner /></Empty.Content></Empty.Root
        >
      {:else}
        {#if !configLoading && bootstrapRequired && !adminPasswordConfigured}
          <Alert.Root variant="destructive" class="mb-4"
            ><Alert.Title>{m.ui_deployment_configuration_incomplete()}</Alert.Title
            ><Alert.Description
              >{m.ui_bootstrap_secret_is_not_configured_on_the_server_the_first_administrator_cannot_()}</Alert.Description
            ></Alert.Root
          >
        {:else if !configLoading && !registrationAvailable}
          <Alert.Root class="mb-4"
            ><Alert.Title>{m.ui_public_registration_is_closed()}</Alert.Title><Alert.Description
              >{m.ui_enter_a_valid_invitation_code_or_contact_your_administrator()}</Alert.Description
            ></Alert.Root
          >
        {/if}
        {#if error}
          <Alert.Root variant="destructive" class="mb-4"
            ><ShieldAlert /><Alert.Title>{m.ui_registration_failed()}</Alert.Title
            ><Alert.Description>{error}</Alert.Description></Alert.Root
          >
        {/if}

        <form onsubmit={handleSubmit}>
          <Field.Group>
            {#if bootstrapRequired}
              <Field.Field
                ><Field.Label for="admin-password">{m.ui_deployment_password()}</Field.Label><Input
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
                ><Field.Label for="invite-code">{m.ui_invitation_code_optional()}</Field.Label
                ><Input
                  id="invite-code"
                  bind:value={inviteCode}
                  autocomplete="off"
                  disabled={loading}
                /></Field.Field
              >
            {/if}
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field.Field>
                <Field.Label for="email">{m.ui_email_address()}</Field.Label>
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
                <Field.Label for="name">{m.ui_your_name_optional()}</Field.Label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <User class="size-4" />
                  </span>
                  <Input
                    id="name"
                    type="text"
                    placeholder={m.ui_alex_smith()}
                    bind:value={name}
                    disabled={loading}
                    class="pl-10"
                  />
                </div>
              </Field.Field>
            </div>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field.Field data-invalid={password.length > 0 && !isPasswordLengthValid}>
                <Field.Label for="password">{m.ui_master_password()}</Field.Label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <KeyRound class="size-4" />
                  </span>
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={m.ui_at_least_8_characters()}
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
                      <EyeOff class="size-4" />
                    {:else}
                      <Eye class="size-4" />
                    {/if}
                  </Button>
                </div>
                <Field.Description>{m.ui_at_least_8_characters_2()}</Field.Description>
              </Field.Field>

              <Field.Field data-invalid={confirmPassword.length > 0 && !isPasswordMatch}>
                <Field.Label for="confirmPassword">{m.ui_confirm_master_password()}</Field.Label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <KeyRound class="size-4" />
                  </span>
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={m.ui_enter_it_again()}
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
                    aria-label={showConfirmPassword
                      ? m.login_hide_password()
                      : m.login_show_password()}
                  >
                    {#if showConfirmPassword}
                      <EyeOff class="size-4" />
                    {:else}
                      <Eye class="size-4" />
                    {/if}
                  </Button>
                </div>
                {#if confirmPassword.length > 0 && !isPasswordMatch}<Field.Error
                    >{m.ui_the_passwords_do_not_match()}</Field.Error
                  >{/if}
              </Field.Field>
            </div>

            <Field.Field>
              <Field.Label for="hint">{m.ui_password_hint_optional()}</Field.Label>
              <Input
                id="hint"
                type="text"
                placeholder={m.ui_for_example_the_author_of_my_favorite_book()}
                bind:value={hint}
                disabled={loading}
              />
              <Field.Description
                >{m.ui_a_hint_can_help_you_remember_your_password_the_server_stores_only_the_hint_text()}</Field.Description
              >
            </Field.Field>

            <Separator />
            <Field.Field>
              <Field.Label for="iterations">{m.ui_pbkdf2_iterations()}</Field.Label>
              <Input
                id="iterations"
                type="number"
                bind:value={iterations}
                min="100000"
                disabled={loading}
              />
              <Field.Description
                >{m.ui_more_iterations_increase_resistance_to_brute_force_attacks_but_take_longer_on_yo()}</Field.Description
              >
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
                  error = m.ui_human_verification_failed_to_load_please_try_again();
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
                <Spinner
                  data-icon="inline-start"
                />{m.ui_deriving_encryption_keys_on_your_device()}{:else}{m.ui_create_my_vault()}{/if}
            </Button>
          </Field.Group>
        </form>
      {/if}
    </Card.Content>

    <Card.Footer class="flex flex-col items-center gap-2 border-t py-4">
      <p class="text-sm text-muted-foreground">
        {m.ui_already_have_an_edgewarden_account()}<a
          href="/login"
          class="text-primary font-medium hover:underline">{m.ui_log_in()}</a
        >
      </p>
    </Card.Footer>
  </Card.Root>
</div>
