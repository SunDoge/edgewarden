<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { ShieldCheck } from "@lucide/svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import AccountPasskeys from "./AccountPasskeys.svelte";
  import AuthRequestSettings from "./AuthRequestSettings.svelte";
  import TwoFactorPasskeys from "./TwoFactorPasskeys.svelte";
  import YubikeySettings from "./YubikeySettings.svelte";

  let {
    profile,
    totpEnabled,
    twoFactorEnabled,
    isAdmin,
    recoveryCode,
    busy,
    onCopy,
    onChangePassword,
    onShowRecoveryCode,
    onDisableTwoFactor,
    onBeginTotp,
    onMessage,
    onError,
    onSessionRevoked,
  }: {
    profile: {
      email: string;
      kdfIterations: number;
      twoFactorEnabled: boolean;
    };
    totpEnabled: boolean;
    twoFactorEnabled: boolean;
    isAdmin: boolean;
    recoveryCode: string;
    busy: string;
    onCopy: (value: string) => void | Promise<void>;
    onChangePassword: () => void;
    onShowRecoveryCode: () => void | Promise<void>;
    onDisableTwoFactor: () => void;
    onBeginTotp: () => void | Promise<void>;
    onMessage: (value: string) => void;
    onError: (value: unknown) => void;
    onSessionRevoked: (reason: string) => void | Promise<void>;
  } = $props();
</script>

<div class="flex flex-col gap-6">
  <Card.Root>
    <Card.Header
      ><Card.Title>{m.login_master_password()}</Card.Title><Card.Description
        >{m.ui_re_encrypts_your_vault_key_and_logs_out_all_devices()}</Card.Description
      ></Card.Header
    >
    <Card.Content
      ><Button variant="outline" onclick={onChangePassword}>{m.ui_change_master_password()}</Button
      ></Card.Content
    >
  </Card.Root>

  <Card.Root>
    <Card.Header
      ><Card.Title>{m.ui_authenticator_app_totp()}</Card.Title><Card.Description
        >{m.ui_protect_login_with_a_totp_compatible_authenticator_app()}</Card.Description
      ></Card.Header
    >
    <Card.Content class="flex flex-col gap-4">
      <div class="flex items-center gap-2">
        <Badge variant={totpEnabled ? "default" : "secondary"}
          >{totpEnabled ? m.ui_enabled() : m.ui_not_enabled()}</Badge
        >
      </div>
      {#if recoveryCode}<div class="flex gap-2">
          <Input value={recoveryCode} readonly class="font-mono" /><Button
            variant="outline"
            size="icon"
            onclick={() => onCopy(recoveryCode)}
            aria-label={m.ui_copy_recovery_code()}>{m.ui_copy()}</Button
          >
        </div>{/if}
      <div class="flex flex-wrap gap-2">
        {#if totpEnabled}<Button
            variant="outline"
            onclick={onShowRecoveryCode}
            disabled={busy === "recovery"}>{m.ui_view_recovery_code()}</Button
          ><Button variant="destructive" onclick={onDisableTwoFactor}
            >{m.ui_turn_off_all_two_step_login_methods()}</Button
          >{:else}<Button onclick={onBeginTotp} disabled={busy === "totp"}
            ><ShieldCheck data-icon="inline-start" />{m.ui_set_up_authenticator()}</Button
          >{/if}
        {#if twoFactorEnabled && !totpEnabled}<Button
            variant="destructive"
            onclick={onDisableTwoFactor}>{m.ui_turn_off_all_two_step_login_methods()}</Button
          >{/if}
      </div>
    </Card.Content>
  </Card.Root>

  <TwoFactorPasskeys
    email={profile.email}
    kdfIterations={profile.kdfIterations}
    {onMessage}
    {onError}
    {onSessionRevoked}
  />
  <YubikeySettings
    email={profile.email}
    kdfIterations={profile.kdfIterations}
    {isAdmin}
    {onMessage}
    {onError}
    {onSessionRevoked}
  />
  <AccountPasskeys
    email={profile.email}
    kdfIterations={profile.kdfIterations}
    {onMessage}
    {onError}
  />
  <AuthRequestSettings email={profile.email} {onMessage} {onError} />
</div>
