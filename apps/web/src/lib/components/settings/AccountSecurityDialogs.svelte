<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Copy, Download, ShieldAlert } from "@lucide/svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  let {
    deleteAccountOpen = $bindable(),
    deleteAccountPassword = $bindable(),
    totpOpen = $bindable(),
    totpKey,
    totpToken = $bindable(),
    verificationOpen = $bindable(),
    verificationPassword = $bindable(),
    verificationAction,
    recoveryOpen = $bindable(),
    recoveryCode,
    recoveryConfirmed = $bindable(),
    disableOpen = $bindable(),
    masterPassword = $bindable(),
    passwordOpen = $bindable(),
    currentPassword = $bindable(),
    newPassword = $bindable(),
    confirmPassword = $bindable(),
    busy,
    onCopy,
    onDeleteAccount,
    onEnableTotp,
    onCancelTotp,
    onVerifySensitiveAction,
    onFinishRecoverySetup,
    onDisableTotp,
    onChangePassword,
  }: {
    deleteAccountOpen: boolean;
    deleteAccountPassword: string;
    totpOpen: boolean;
    totpKey: string;
    totpToken: string;
    verificationOpen: boolean;
    verificationPassword: string;
    verificationAction: "totp" | "recovery" | "api-key-reveal" | "api-key-rotate";
    recoveryOpen: boolean;
    recoveryCode: string;
    recoveryConfirmed: boolean;
    disableOpen: boolean;
    masterPassword: string;
    passwordOpen: boolean;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    busy: string;
    onCopy: (value: string) => void;
    onDeleteAccount: () => void;
    onEnableTotp: () => void;
    onCancelTotp: () => void;
    onVerifySensitiveAction: () => void;
    onFinishRecoverySetup: () => void;
    onDisableTotp: () => void;
    onChangePassword: () => void;
  } = $props();

  function downloadRecoveryCode() {
    const blob = new Blob(
      [
        m.ui_edgewarden_two_step_login_recovery_code(),
        `${recoveryCode}\n\n`,
        m.ui_this_code_can_only_be_used_once_store_it_securely_offline(),
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "edgewarden-recovery-code.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }
</script>

<Dialog.Root bind:open={deleteAccountOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_permanently_delete_account()}</Dialog.Title><Dialog.Description
        >{m.ui_this_cannot_be_undone_your_personal_vault_and_account_data_will_be_deleted_inclu()}</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="delete-account-password">{m.ui_current_master_password()}</Field.Label
      ><Input
        id="delete-account-password"
        type="password"
        bind:value={deleteAccountPassword}
        autocomplete="current-password"
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (deleteAccountOpen = false)}
        >{m.login_cancel()}</Button
      ><Button
        variant="destructive"
        onclick={onDeleteAccount}
        disabled={!deleteAccountPassword || busy === "delete-account"}
        >{m.ui_delete_permanently()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root
  open={verificationOpen}
  onOpenChange={(open) => {
    verificationOpen = open;
    if (!open) verificationPassword = "";
  }}
>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{m.ui_verify_master_password()}</Dialog.Title>
      <Dialog.Description>
        {verificationAction === "totp"
          ? m.ui_verify_your_identity_before_setting_up_an_authenticator()
          : verificationAction === "recovery"
            ? m.ui_your_recovery_code_is_sensitive_verify_your_identity_before_viewing_it()
            : verificationAction === "api-key-reveal"
              ? m.ui_your_api_key_is_an_account_credential_verify_your_identity_before_viewing_it()
              : m.ui_rotating_your_api_key_immediately_invalidates_the_old_one_verify_your_identity_t()}
      </Dialog.Description>
    </Dialog.Header>
    <Field.Field>
      <Field.Label for="two-factor-verification-password"
        >{m.ui_current_master_password()}</Field.Label
      >
      <Input
        id="two-factor-verification-password"
        type="password"
        bind:value={verificationPassword}
        autocomplete="current-password"
      />
    </Field.Field>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (verificationOpen = false)}
        >{m.login_cancel()}</Button
      >
      <Button
        onclick={onVerifySensitiveAction}
        disabled={!verificationPassword || busy === "verification"}>{m.ui_continue()}</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root
  open={totpOpen}
  onOpenChange={(open) => {
    totpOpen = open;
    if (!open) onCancelTotp();
  }}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_set_up_authenticator()}</Dialog.Title><Dialog.Description
        >{m.ui_enter_the_key_in_your_authenticator_app_then_enter_the_6_digit_code_it_generates()}</Dialog.Description
      ></Dialog.Header
    ><Field.Group
      ><Field.Field
        ><Field.Label>{m.ui_key()}</Field.Label>
        <div class="flex gap-2">
          <Input value={totpKey} readonly class="font-mono" /><Button
            variant="outline"
            size="icon"
            onclick={() => onCopy(totpKey)}
            aria-label={m.ui_copy_key()}><Copy /></Button
          >
        </div></Field.Field
      ><Field.Field
        ><Field.Label for="totp-token">{m.nav_totp()}</Field.Label><Input
          bind:value={totpToken}
          inputmode="numeric"
          maxlength={6}
          autocomplete="one-time-code"
        /></Field.Field
      ></Field.Group
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (totpOpen = false)}>{m.login_cancel()}</Button
      ><Button
        onclick={onEnableTotp}
        disabled={!/^\d{6}$/.test(totpToken) || busy === "totp-enable"}>{m.ui_enable()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root
  open={recoveryOpen}
  onOpenChange={(open) => {
    recoveryOpen = open || !recoveryConfirmed;
  }}
>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{m.ui_save_your_recovery_code()}</Dialog.Title>
      <Dialog.Description
        >{m.ui_if_you_lose_your_authenticator_this_is_your_backup_credential_for_turning_off_tw()}</Dialog.Description
      >
    </Dialog.Header>
    <Alert.Root>
      <ShieldAlert />
      <Alert.Title>{m.ui_keep_this_code_private_and_save_it_now()}</Alert.Title>
      <Alert.Description
        >{m.ui_this_code_can_only_be_used_once_do_not_keep_it_only_in_this_vault_download_it_an()}</Alert.Description
      >
    </Alert.Root>
    <Field.Group>
      <Field.Field>
        <Field.Label for="new-recovery-code">{m.login_recovery_code()}</Field.Label>
        <div class="flex gap-2">
          <Input id="new-recovery-code" value={recoveryCode} readonly class="font-mono" />
          <Button
            variant="outline"
            size="icon"
            onclick={() => onCopy(recoveryCode)}
            aria-label={m.ui_copy_recovery_code()}><Copy /></Button
          >
        </div>
      </Field.Field>
      <Field.Field orientation="horizontal">
        <Checkbox id="recovery-code-saved" bind:checked={recoveryConfirmed} />
        <Field.Label for="recovery-code-saved"
          >{m.ui_i_saved_my_recovery_code_somewhere_safe_outside_this_vault()}</Field.Label
        >
      </Field.Field>
    </Field.Group>
    <Dialog.Footer>
      <Button variant="outline" onclick={downloadRecoveryCode}>
        <Download data-icon="inline-start" />{m.ui_download()}</Button
      >
      <Button onclick={onFinishRecoverySetup} disabled={!recoveryConfirmed}
        >{m.ui_save_and_log_in_again()}</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={disableOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_turn_off_two_step_login()}</Dialog.Title><Dialog.Description
        >{m.ui_enter_your_master_password_to_confirm_existing_sessions_will_be_revoked_and_you_()}</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="master-password">{m.login_master_password()}</Field.Label><Input
        id="master-password"
        type="password"
        bind:value={masterPassword}
        autocomplete="current-password"
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (disableOpen = false)}>{m.login_cancel()}</Button
      ><Button
        variant="destructive"
        onclick={onDisableTotp}
        disabled={!masterPassword || busy === "totp-disable"}>{m.ui_confirm_disabling()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root bind:open={passwordOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_change_master_password()}</Dialog.Title><Dialog.Description
        >{m.ui_your_vault_key_will_be_re_encrypted_with_the_new_password_you_will_need_to_log_i()}</Dialog.Description
      ></Dialog.Header
    ><Field.Group
      ><Field.Field
        ><Field.Label for="current-password">{m.ui_current_master_password()}</Field.Label><Input
          id="current-password"
          type="password"
          bind:value={currentPassword}
          autocomplete="current-password"
        /></Field.Field
      ><Field.Field
        ><Field.Label for="new-password">{m.ui_new_master_password()}</Field.Label><Input
          id="new-password"
          type="password"
          bind:value={newPassword}
          autocomplete="new-password"
        /><Field.Description>{m.ui_at_least_12_characters()}</Field.Description></Field.Field
      ><Field.Field
        ><Field.Label for="confirm-password">{m.ui_confirm_new_master_password()}</Field.Label
        ><Input
          id="confirm-password"
          type="password"
          bind:value={confirmPassword}
          autocomplete="new-password"
        /></Field.Field
      ></Field.Group
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (passwordOpen = false)}>{m.login_cancel()}</Button
      ><Button
        variant="destructive"
        onclick={onChangePassword}
        disabled={!currentPassword ||
          newPassword.length < 12 ||
          !confirmPassword ||
          busy === "password"}>{m.ui_change_and_log_out()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>
