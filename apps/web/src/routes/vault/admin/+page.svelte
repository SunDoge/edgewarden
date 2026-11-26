<script lang="ts">
  import { formatDateTime } from "#lib/i18n/format.ts";
  import * as m from "#lib/paraglide/messages.js";

  import {
    ArrowLeft,
    Copy,
    RefreshCw,
    Search,
    ShieldAlert,
    Trash2,
    UserRoundCog,
  } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import * as Field from "#lib/components/ui/field/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Select from "#lib/components/ui/select/index.js";
  import { Switch } from "#lib/components/ui/switch/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import { searchAdminUsers } from "#lib/services/admin-search.ts";
  import {
    createAdminInviteApi,
    deleteAdminInviteApi,
    deleteAdminUserApi,
    getAdminPushRelayStatusApi,
    getAdminEmailSettingsApi,
    getAdminRegistrationPolicyApi,
    listAdminInvitesApi,
    listAdminUsersApi,
    setAdminUserStatusApi,
    updateAdminRegistrationPolicyApi,
    updateAdminEmailSettingsApi,
    updateAdminPushRelaySettingsApi,
    testAdminEmailSettingsApi,
    testAdminPushRelaySettingsApi,
  } from "#lib/services/api-admin.ts";
  import { deriveAccountPasswordHash } from "#lib/services/api-auth.ts";
  import { vault } from "#lib/stores/vault.svelte.ts";
  import VaultPageShell from "#lib/components/vault/VaultPageShell.svelte";
  import type { AdminInvite, AdminUser } from "#lib/services/admin-types.ts";
  import type { AdminEmailSettings, AdminPushRelayStatus } from "#lib/services/api-admin.ts";

  let users = $state<AdminUser[]>([]);
  let invites = $state<AdminInvite[]>([]);
  let masterPassword = $state("");
  let confirmationOpen = $state(false);
  let confirmationError = $state<string | null>(null);
  let pendingOperation = $state<{
    key: string;
    operation: (hash: string) => Promise<unknown>;
  } | null>(null);
  let expiresInHours = $state(168);
  let inviteEmail = $state("");
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let signupsAllowed = $state(false);
  let invitationsAllowed = $state(true);
  let pushRelay = $state<AdminPushRelayStatus | null>(null);
  let pushInstallationId = $state("");
  let pushInstallationKey = $state("");
  let clearPushInstallationId = $state(false);
  let clearPushInstallationKey = $state(false);
  let emailSettings = $state<AdminEmailSettings | null>(null);
  let resendApiKey = $state("");
  let clearResendApiKey = $state(false);
  let userSearchQuery = $state("");
  let deleteUser = $state<AdminUser | null>(null);
  const filteredUsers = $derived(searchAdminUsers(users, userSearchQuery));

  async function refresh() {
    busy = "refresh";
    error = null;
    try {
      const [nextUsers, nextInvites, policy, nextPushRelay, nextEmailSettings] = await Promise.all([
        listAdminUsersApi().then((r) => r.data),
        listAdminInvitesApi().then((r) => r.data),
        getAdminRegistrationPolicyApi(),
        getAdminPushRelayStatusApi(),
        getAdminEmailSettingsApi(),
      ]);
      users = nextUsers;
      invites = nextInvites;
      signupsAllowed = policy.signupsAllowed;
      invitationsAllowed = policy.invitationsAllowed;
      pushRelay = nextPushRelay;
      emailSettings = nextEmailSettings;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      busy = null;
    }
  }

  async function passwordHash() {
    if (!masterPassword) throw new Error(m.ui_enter_your_current_master_password_to_confirm());
    const email = vault.profile?.email;
    if (!email) throw new Error(m.ui_account_details_have_not_loaded_yet());
    return deriveAccountPasswordHash(email, masterPassword);
  }

  function requestConfirmation(key: string, operation: (hash: string) => Promise<unknown>) {
    masterPassword = "";
    error = null;
    confirmationError = null;
    pendingOperation = { key, operation };
    confirmationOpen = true;
  }

  function closeConfirmation() {
    if (busy !== null) return;
    confirmationOpen = false;
    confirmationError = null;
    masterPassword = "";
    pendingOperation = null;
  }

  async function confirmOperation() {
    if (!pendingOperation) return;
    const pending = pendingOperation;
    busy = pending.key;
    confirmationError = null;
    try {
      await pending.operation(await passwordHash());
      masterPassword = "";
      confirmationOpen = false;
      pendingOperation = null;
      await refresh();
    } catch (reason) {
      confirmationError = reason instanceof Error ? reason.message : String(reason);
      masterPassword = "";
    } finally {
      busy = null;
    }
  }

  function createInvite() {
    requestConfirmation("invite-create", async (hash) => {
      const invite = await createAdminInviteApi(hash, inviteEmail, expiresInHours);
      await navigator.clipboard.writeText(invite.inviteLink);
      inviteEmail = "";
    });
  }

  function saveRegistrationPolicy() {
    requestConfirmation("registration-policy", (hash) =>
      updateAdminRegistrationPolicyApi(hash, signupsAllowed, invitationsAllowed),
    );
  }

  function saveEmailSettings() {
    if (!emailSettings) return;
    requestConfirmation("email-settings", async (hash) => {
      await updateAdminEmailSettingsApi(hash, {
        enabled: emailSettings!.enabled,
        provider: emailSettings!.provider,
        from: emailSettings!.from,
        replyTo: emailSettings!.replyTo,
        privacyMode: emailSettings!.privacyMode,
        resendApiKey: resendApiKey || undefined,
        clearResendApiKey,
      });
      resendApiKey = "";
      clearResendApiKey = false;
    });
  }

  function sendTestEmail() {
    requestConfirmation("email-test", (hash) => testAdminEmailSettingsApi(hash));
  }

  function savePushRelaySettings() {
    if (!pushRelay) return;
    requestConfirmation("push-relay-settings", async (hash) => {
      await updateAdminPushRelaySettingsApi(hash, {
        region: pushRelay!.region,
        installationId: pushInstallationId || undefined,
        installationKey: pushInstallationKey || undefined,
        clearInstallationId: clearPushInstallationId,
        clearInstallationKey: clearPushInstallationKey,
      });
      pushInstallationId = "";
      pushInstallationKey = "";
      clearPushInstallationId = false;
      clearPushInstallationKey = false;
    });
  }

  function testPushRelaySettings() {
    requestConfirmation("push-relay-test", (hash) => testAdminPushRelaySettingsApi(hash));
  }

  function confirmDeleteUser() {
    if (!deleteUser) return;
    const user = deleteUser;
    deleteUser = null;
    requestConfirmation(`delete-${user.id}`, (hash) => deleteAdminUserApi(user.id, hash));
  }

  onMount(() => {
    if (vault.profile?.role !== "admin") void goto("/vault");
    else void refresh();
  });
</script>

<svelte:head><title>{m.ui_user_management_edgewarden()}</title></svelte:head>

<VaultPageShell
  title={m.nav_users()}
  description={m.ui_sensitive_administrative_actions_require_your_master_password_again()}
>
  {#snippet actions()}<Button variant="outline" onclick={refresh} disabled={busy !== null}
      ><RefreshCw data-icon="inline-start" />{m.ui_refresh()}</Button
    >{/snippet}
  {#if error}<Alert.Root variant="destructive"
      ><ShieldAlert /><Alert.Title>{m.ui_administrative_action_failed()}</Alert.Title
      ><Alert.Description>{error}</Alert.Description></Alert.Root
    >{/if}

  <Tabs.Root value="users" class="flex flex-col gap-4">
    <Tabs.List class="grid h-auto w-full grid-cols-2 sm:grid-cols-4"
      ><Tabs.Trigger value="users">{m.ui_users()}</Tabs.Trigger><Tabs.Trigger value="registration"
        >{m.ui_registration_and_invitations()}</Tabs.Trigger
      ><Tabs.Trigger value="email">{m.ui_email_2()}</Tabs.Trigger><Tabs.Trigger value="operations"
        >{m.ui_service_status()}</Tabs.Trigger
      ></Tabs.List
    >
    <Tabs.Content value="registration" class="mt-0 flex flex-col gap-6">
      <section class="rounded-lg border bg-card p-4">
        <div class="flex flex-col gap-4">
          <div>
            <h2 class="font-semibold">{m.ui_registration_policy()}</h2>
            <p class="text-xs text-muted-foreground">
              {m.ui_changes_are_saved_immediately_and_override_deployment_defaults()}
            </p>
          </div>
          <Field.Group
            ><Field.Field orientation="horizontal"
              ><Field.Content
                ><Field.Label for="public-signups">{m.ui_allow_public_registration()}</Field.Label
                ><Field.Description
                  >{m.ui_new_accounts_can_register_without_an_invitation()}</Field.Description
                ></Field.Content
              ><Switch
                id="public-signups"
                bind:checked={signupsAllowed}
                disabled={busy !== null}
              /></Field.Field
            ><Field.Field orientation="horizontal"
              ><Field.Content
                ><Field.Label for="invite-signups">{m.ui_allow_invited_registrations()}</Field.Label
                ><Field.Description
                  >{m.ui_when_disabled_existing_invitation_codes_cannot_be_used_either()}</Field.Description
                ></Field.Content
              ><Switch
                id="invite-signups"
                bind:checked={invitationsAllowed}
                disabled={busy !== null}
              /></Field.Field
            ></Field.Group
          ><Button class="self-start" onclick={saveRegistrationPolicy} disabled={busy !== null}
            >{m.ui_save_registration_policy()}</Button
          >
        </div>
      </section>

      <section class="min-w-0 rounded-lg border bg-card">
        <header
          class="flex flex-col items-stretch justify-between gap-3 border-b p-4 lg:flex-row lg:items-end"
        >
          <div>
            <h2 class="font-semibold">{m.ui_invitation_codes()}</h2>
            <p class="text-xs text-muted-foreground">
              {m.ui_each_invitation_is_restricted_to_its_email_address_its_registration_link_is_copi()}
            </p>
          </div>
          <div class="grid items-end gap-2 sm:grid-cols-[1fr_7rem_auto]">
            <Field.Field
              ><Field.Label for="invite-email">{m.ui_invitee_email()}</Field.Label><Input
                id="invite-email"
                type="email"
                bind:value={inviteEmail}
                placeholder="name@example.com"
                required
              /></Field.Field
            ><Field.Field
              ><Field.Label for="invite-hours">{m.ui_valid_for_hours()}</Field.Label><Input
                id="invite-hours"
                type="number"
                min="1"
                max="720"
                bind:value={expiresInHours}
              /></Field.Field
            ><Button onclick={createInvite} disabled={busy !== null || !inviteEmail.trim()}
              >{m.ui_create_and_copy()}</Button
            >
          </div>
        </header>
        <div class="overflow-x-auto">
          <Table.Root
            ><Table.Header
              ><Table.Row
                ><Table.Head>{m.ui_email_2()}</Table.Head><Table.Head>{m.ui_status()}</Table.Head
                ><Table.Head>{m.ui_expires()}</Table.Head><Table.Head
                  >{m.ui_registration_link()}</Table.Head
                ><Table.Head class="text-end">{m.ui_actions()}</Table.Head></Table.Row
              ></Table.Header
            ><Table.Body
              >{#each invites as invite (invite.code)}<Table.Row
                  ><Table.Cell>{invite.email}</Table.Cell><Table.Cell
                    ><Badge variant={invite.status === "active" ? "secondary" : "outline"}
                      >{invite.status}</Badge
                    ></Table.Cell
                  ><Table.Cell>{formatDateTime(invite.expiresAt)}</Table.Cell><Table.Cell
                    ><Button
                      size="sm"
                      variant="ghost"
                      onclick={() => navigator.clipboard.writeText(invite.inviteLink)}
                      ><Copy data-icon="inline-start" />{m.ui_copy()}</Button
                    ></Table.Cell
                  ><Table.Cell class="text-end"
                    ><Button
                      size="sm"
                      variant="destructive"
                      disabled={busy !== null}
                      onclick={() =>
                        requestConfirmation(`invite-${invite.code}`, (hash) =>
                          deleteAdminInviteApi(invite.code, hash),
                        )}><Trash2 data-icon="inline-start" />{m.ui_delete()}</Button
                    ></Table.Cell
                  ></Table.Row
                >{/each}</Table.Body
            ></Table.Root
          >
        </div>
      </section>
    </Tabs.Content>

    <Tabs.Content value="email" class="mt-0">
      <section class="rounded-lg border bg-card p-4">
        {#if emailSettings}
          <div class="flex flex-col gap-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="font-semibold">{m.ui_transactional_email()}</h2>
                <p class="text-xs text-muted-foreground">
                  {m.ui_email_settings_description()}
                </p>
              </div>
              <Badge variant={emailSettings.activeProvider ? "secondary" : "outline"}
                >{emailSettings.activeProvider ?? m.ui_off()}</Badge
              >
            </div>
            {#if emailSettings.environmentOverrides.length}
              <Alert.Root>
                <ShieldAlert /><Alert.Title>{m.ui_environment_overrides_active()}</Alert.Title>
                <Alert.Description
                  >{emailSettings.environmentOverrides.join(", ")}</Alert.Description
                >
              </Alert.Root>
            {/if}
            <Field.Group class="grid gap-4 md:grid-cols-2">
              <Field.Field orientation="horizontal" class="md:col-span-2">
                <Field.Content
                  ><Field.Label for="email-enabled">{m.ui_enable_email()}</Field.Label
                  ></Field.Content
                >
                <Switch id="email-enabled" bind:checked={emailSettings.enabled} />
              </Field.Field>
              <Field.Field>
                <Field.Label>{m.ui_provider()}</Field.Label>
                <Select.Root
                  type="single"
                  value={emailSettings.provider}
                  onValueChange={(value) =>
                    (emailSettings!.provider = value as AdminEmailSettings["provider"])}
                >
                  <Select.Trigger class="w-full">{emailSettings.provider}</Select.Trigger>
                  <Select.Content
                    ><Select.Item value="auto">auto</Select.Item><Select.Item value="cloudflare"
                      >Cloudflare</Select.Item
                    ><Select.Item value="resend">Resend</Select.Item></Select.Content
                  >
                </Select.Root>
              </Field.Field>
              <Field.Field>
                <Field.Label>{m.ui_privacy_mode()}</Field.Label>
                <Select.Root
                  type="single"
                  value={emailSettings.privacyMode}
                  onValueChange={(value) =>
                    (emailSettings!.privacyMode = value as AdminEmailSettings["privacyMode"])}
                >
                  <Select.Trigger class="w-full">{emailSettings.privacyMode}</Select.Trigger>
                  <Select.Content
                    ><Select.Item value="minimal">minimal</Select.Item><Select.Item value="detailed"
                      >detailed</Select.Item
                    ></Select.Content
                  >
                </Select.Root>
              </Field.Field>
              <Field.Field>
                <Field.Label for="email-from">From</Field.Label>
                <Input
                  id="email-from"
                  bind:value={emailSettings.from}
                  placeholder="Edgewarden <vault@example.com>"
                />
              </Field.Field>
              <Field.Field>
                <Field.Label for="email-reply-to">Reply-To</Field.Label>
                <Input
                  id="email-reply-to"
                  bind:value={emailSettings.replyTo}
                  placeholder="support@example.com"
                />
              </Field.Field>
              <Field.Field class="md:col-span-2">
                <Field.Label for="resend-api-key">Resend API key</Field.Label>
                <Input
                  id="resend-api-key"
                  type="password"
                  bind:value={resendApiKey}
                  autocomplete="new-password"
                  placeholder={emailSettings.resendApiKeyConfigured
                    ? m.ui_resend_key_configured_placeholder()
                    : "re_…"}
                />
              </Field.Field>
              <Field.Field orientation="horizontal" class="md:col-span-2">
                <Field.Content
                  ><Field.Label for="clear-resend-key"
                    >{m.ui_remove_stored_resend_key()}</Field.Label
                  ></Field.Content
                >
                <Switch id="clear-resend-key" bind:checked={clearResendApiKey} />
              </Field.Field>
            </Field.Group>
            <div class="flex flex-wrap gap-2">
              <Button onclick={saveEmailSettings} disabled={busy !== null}
                >{m.ui_save_email_settings()}</Button
              >
              <Button
                variant="outline"
                onclick={sendTestEmail}
                disabled={busy !== null || !emailSettings.activeProvider}
                >{m.ui_send_test_to_my_account()}</Button
              >
            </div>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">{m.ui_loading_email_settings()}</p>
        {/if}
      </section>
    </Tabs.Content>

    <Tabs.Content value="operations" class="mt-0">
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center justify-between gap-3">
            {m.ui_mobile_push_relay()}
            <Badge variant={pushRelay?.enabled ? "secondary" : "outline"}
              >{pushRelay?.enabled ? m.ui_on() : m.ui_off()}</Badge
            >
          </Card.Title>
          <Card.Description>
            {m.ui_background_sync_and_device_login_approval_notifications_for_bitwarden_android_an()}
          </Card.Description>
        </Card.Header>
        {#if pushRelay}
          <Card.Content class="flex flex-col gap-5">
            {#if pushRelay.environmentOverrides.length}
              <Alert.Root>
                <ShieldAlert /><Alert.Title>{m.ui_environment_overrides_active()}</Alert.Title>
                <Alert.Description>{pushRelay.environmentOverrides.join(", ")}</Alert.Description>
              </Alert.Root>
            {/if}
            <Field.Group class="grid gap-4 md:grid-cols-2">
              <Field.Field>
                <Field.Label>{m.ui_region()}</Field.Label>
                <Select.Root
                  type="single"
                  value={pushRelay.region}
                  onValueChange={(value) =>
                    (pushRelay!.region = value as AdminPushRelayStatus["region"])}
                >
                  <Select.Trigger class="w-full">{pushRelay.region}</Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      <Select.Item value="US">US</Select.Item>
                      <Select.Item value="EU">EU</Select.Item>
                    </Select.Group>
                  </Select.Content>
                </Select.Root>
              </Field.Field>
              <Field.Field>
                <Field.Label for="push-installation-id">Installation ID</Field.Label>
                <Input
                  id="push-installation-id"
                  bind:value={pushInstallationId}
                  autocomplete="off"
                  placeholder={pushRelay.installationIdConfigured
                    ? m.ui_push_credential_configured_placeholder()
                    : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
                />
              </Field.Field>
              <Field.Field class="md:col-span-2">
                <Field.Label for="push-installation-key">Installation Key</Field.Label>
                <Input
                  id="push-installation-key"
                  type="password"
                  bind:value={pushInstallationKey}
                  autocomplete="new-password"
                  placeholder={pushRelay.installationKeyConfigured
                    ? m.ui_push_credential_configured_placeholder()
                    : m.ui_enter_push_installation_key()}
                />
              </Field.Field>
              <Field.Field orientation="horizontal">
                <Field.Content>
                  <Field.Label for="clear-push-installation-id">
                    {m.ui_remove_stored_installation_id()}
                  </Field.Label>
                </Field.Content>
                <Switch id="clear-push-installation-id" bind:checked={clearPushInstallationId} />
              </Field.Field>
              <Field.Field orientation="horizontal">
                <Field.Content>
                  <Field.Label for="clear-push-installation-key">
                    {m.ui_remove_stored_installation_key()}
                  </Field.Label>
                </Field.Content>
                <Switch id="clear-push-installation-key" bind:checked={clearPushInstallationKey} />
              </Field.Field>
            </Field.Group>
            {#if pushRelay.reason === "invalid_region"}
              <p class="text-sm text-destructive">{m.ui_push_region_must_be_us_or_eu()}</p>
            {:else if !pushRelay.enabled}
              <p class="text-sm text-muted-foreground">
                {m.ui_enabled_automatically_when_both_push_installation_id_and_push_installation_key_a()}
              </p>
            {/if}
          </Card.Content>
          <Card.Footer class="flex-wrap gap-2">
            <Button onclick={savePushRelaySettings} disabled={busy !== null}
              >{m.ui_save_push_relay_settings()}</Button
            >
            <Button
              variant="outline"
              onclick={testPushRelaySettings}
              disabled={busy !== null || !pushRelay.enabled}
              >{m.ui_test_push_relay_connection()}</Button
            >
          </Card.Footer>
        {:else}
          <Card.Content>
            <p class="text-sm text-muted-foreground">{m.ui_loading_push_relay_status()}</p>
          </Card.Content>
        {/if}
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="users" class="mt-0">
      <section class="min-w-0 rounded-lg border bg-card">
        <header
          class="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h2 class="font-semibold">{m.ui_users()}</h2>
            <p class="text-xs text-muted-foreground">
              {m.ui_accounts_value({
                value0: userSearchQuery.trim()
                  ? `${filteredUsers.length} / ${users.length}`
                  : users.length,
              })}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <div class="relative min-w-0 sm:w-72">
              <Search
                class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              /><Input
                type="search"
                class="pl-9"
                bind:value={userSearchQuery}
                placeholder={m.ui_search_by_name_email_role_or_status()}
                aria-label={m.ui_search_users()}
              />
            </div>
            <UserRoundCog class="hidden shrink-0 sm:block" />
          </div>
        </header>
        <div class="overflow-x-auto">
          <Table.Root
            ><Table.Header
              ><Table.Row
                ><Table.Head>{m.ui_account()}</Table.Head><Table.Head>{m.ui_role()}</Table.Head
                ><Table.Head>{m.ui_status()}</Table.Head><Table.Head
                  >{m.ui_two_step_login()}</Table.Head
                ><Table.Head class="text-end">{m.ui_actions()}</Table.Head></Table.Row
              ></Table.Header
            ><Table.Body
              >{#each filteredUsers as user (user.id)}<Table.Row
                  ><Table.Cell
                    ><p class="font-medium">{user.name || m.ui_untitled()}</p>
                    <p class="text-xs text-muted-foreground">{user.email}</p></Table.Cell
                  ><Table.Cell><Badge variant="outline">{user.role}</Badge></Table.Cell><Table.Cell
                    ><Badge variant={user.status === "active" ? "secondary" : "destructive"}
                      >{user.status}</Badge
                    ></Table.Cell
                  ><Table.Cell
                    >{user.twoFactorEnabled ? m.ui_enabled() : m.ui_not_enabled()}</Table.Cell
                  ><Table.Cell class="text-end"
                    ><div class="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || user.id === vault.profile?.id}
                        onclick={() =>
                          requestConfirmation(`status-${user.id}`, (hash) =>
                            setAdminUserStatusApi(
                              user.id,
                              user.status === "active" ? "banned" : "active",
                              hash,
                            ),
                          )}>{user.status === "active" ? m.ui_suspend() : m.ui_enable()}</Button
                      ><Button
                        size="sm"
                        variant="destructive"
                        disabled={busy !== null || user.id === vault.profile?.id}
                        onclick={() => (deleteUser = user)}
                        ><Trash2 data-icon="inline-start" />{m.ui_delete()}</Button
                      >
                    </div></Table.Cell
                  ></Table.Row
                >{:else}<Table.Row
                  ><Table.Cell colspan={5} class="h-24 text-center text-muted-foreground"
                    >{m.ui_no_matching_users()}</Table.Cell
                  ></Table.Row
                >{/each}</Table.Body
            ></Table.Root
          >
        </div>
      </section>
    </Tabs.Content>
  </Tabs.Root>
</VaultPageShell>

<Dialog.Root
  open={confirmationOpen}
  onOpenChange={(open) => {
    if (!open) closeConfirmation();
  }}
>
  <Dialog.Content class="sm:max-w-md">
    <form
      class="flex flex-col gap-4"
      onsubmit={(event) => {
        event.preventDefault();
        void confirmOperation();
      }}
    >
      <Dialog.Header>
        <Dialog.Title>{m.ui_confirm_action()}</Dialog.Title>
        <Dialog.Description>
          {m.ui_sensitive_administrative_actions_require_your_master_password_again()}
        </Dialog.Description>
      </Dialog.Header>
      {#if confirmationError}
        <Alert.Root variant="destructive">
          <ShieldAlert />
          <Alert.Title>{m.ui_administrative_action_failed()}</Alert.Title>
          <Alert.Description>{confirmationError}</Alert.Description>
        </Alert.Root>
      {/if}
      <Field.Group>
        <Field.Field data-invalid={Boolean(confirmationError)}>
          <Field.Label for="admin-password">{m.ui_current_master_password()}</Field.Label>
          <Input
            id="admin-password"
            type="password"
            bind:value={masterPassword}
            autocomplete="current-password"
            aria-invalid={Boolean(confirmationError)}
            autofocus
          />
          <Field.Description>
            {m.ui_used_only_to_derive_a_verification_hash_in_your_browser_it_is_not_saved()}
          </Field.Description>
        </Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Button
          type="button"
          variant="outline"
          onclick={closeConfirmation}
          disabled={busy !== null}
        >
          {m.login_cancel()}
        </Button>
        <Button type="submit" disabled={busy !== null || !masterPassword}>
          {m.ui_confirm()}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
  open={deleteUser !== null}
  onOpenChange={(open) => {
    if (!open) deleteUser = null;
  }}
  ><AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_permanently_delete_user()}</AlertDialog.Title
      ><AlertDialog.Description
        >{m.ui_permanently_delete_value_and_all_their_vault_data_devices_and_sessions_this_cann({
          value0: deleteUser?.email ?? "",
        })}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={confirmDeleteUser}>{m.ui_confirm_deletion()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  ></AlertDialog.Root
>
