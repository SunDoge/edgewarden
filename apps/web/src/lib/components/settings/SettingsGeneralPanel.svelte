<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Copy, KeyRound, RefreshCw } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";

  let {
    email,
    theme = $bindable(),
    lockTimeoutMinutes = $bindable(),
    sessionTimeoutAction = $bindable(),
    name = $bindable(),
    hint = $bindable(),
    apiKey,
    busy,
    onSavePreferences,
    onSaveProfile,
    onCopy,
    onRevealApiKey,
    onRotateApiKey,
  }: {
    email: string;
    theme: "system" | "light" | "dark";
    lockTimeoutMinutes: string;
    sessionTimeoutAction: "lock" | "logout";
    name: string;
    hint: string;
    apiKey: string;
    busy: string;
    onSavePreferences: () => void;
    onSaveProfile: () => void | Promise<void>;
    onCopy: (value: string) => void | Promise<void>;
    onRevealApiKey: () => void | Promise<void>;
    onRotateApiKey: () => void;
  } = $props();
</script>

<div class="flex flex-col gap-6">
  <Card.Root>
    <Card.Header
      ><Card.Title>{m.ui_appearance_and_sessions()}</Card.Title><Card.Description
        >{m.ui_preferences_are_stored_only_in_this_browser_and_contain_no_passwords_or_vault_ke()}</Card.Description
      ></Card.Header
    >
    <Card.Content>
      <Field.Group>
        <Field.Field
          ><Field.Label>{m.ui_theme()}</Field.Label><Select.Root type="single" bind:value={theme}
            ><Select.Trigger
              >{theme === "system"
                ? m.ui_system_2()
                : theme === "light"
                  ? m.ui_light()
                  : m.ui_dark()}</Select.Trigger
            ><Select.Content
              ><Select.Group
                ><Select.Item value="system">{m.ui_system_2()}</Select.Item><Select.Item
                  value="light">{m.ui_light()}</Select.Item
                ><Select.Item value="dark">{m.ui_dark()}</Select.Item></Select.Group
              ></Select.Content
            ></Select.Root
          ></Field.Field
        >
        <Field.Field
          ><Field.Label>{m.ui_inactivity_timeout()}</Field.Label><Select.Root
            type="single"
            bind:value={lockTimeoutMinutes}
            ><Select.Trigger
              >{lockTimeoutMinutes === "0"
                ? m.ui_never_2()
                : m.ui_value_minutes({ value0: lockTimeoutMinutes })}</Select.Trigger
            ><Select.Content
              ><Select.Group
                ><Select.Item value="1">{m.ui_1_minute()}</Select.Item><Select.Item value="5"
                  >{m.ui_5_minutes()}</Select.Item
                ><Select.Item value="15">{m.ui_15_minutes()}</Select.Item><Select.Item value="30"
                  >{m.ui_30_minutes()}</Select.Item
                ><Select.Item value="0">{m.ui_never_2()}</Select.Item></Select.Group
              ></Select.Content
            ></Select.Root
          ></Field.Field
        >
        <Field.Field
          ><Field.Label>{m.ui_timeout_action()}</Field.Label><Select.Root
            type="single"
            bind:value={sessionTimeoutAction}
            ><Select.Trigger
              >{sessionTimeoutAction === "lock"
                ? m.ui_lock_vault()
                : m.ui_log_out()}</Select.Trigger
            ><Select.Content
              ><Select.Group
                ><Select.Item value="lock">{m.ui_lock_vault()}</Select.Item><Select.Item
                  value="logout">{m.ui_log_out_and_clear_offline_cache()}</Select.Item
                ></Select.Group
              ></Select.Content
            ></Select.Root
          ><Field.Description
            >{m.ui_locking_keeps_the_encrypted_offline_cache_logging_out_clears_both_the_cache_and_()}</Field.Description
          ></Field.Field
        >
        <Field.Field orientation="horizontal"
          ><Button onclick={onSavePreferences}>{m.ui_save_preferences()}</Button></Field.Field
        >
      </Field.Group>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header
      ><Card.Title>{m.ui_profile()}</Card.Title><Card.Description>{email}</Card.Description
      ></Card.Header
    >
    <Card.Content>
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void onSaveProfile();
        }}
      >
        <Field.Group>
          <Field.Field
            ><Field.Label for="name">{m.ui_display_name()}</Field.Label><Input
              id="name"
              bind:value={name}
              autocomplete="name"
            /></Field.Field
          >
          <Field.Field
            ><Field.Label for="hint">{m.ui_master_password_hint()}</Field.Label><Input
              id="hint"
              bind:value={hint}
            /><Field.Description
              >{m.ui_this_page_does_not_show_your_hint_to_users_who_are_not_logged_in()}</Field.Description
            ></Field.Field
          >
          <Field.Field orientation="horizontal"
            ><Button type="submit" disabled={busy === "profile"}
              >{busy === "profile" ? m.ui_saving_2() : m.ui_save_profile()}</Button
            ></Field.Field
          >
        </Field.Group>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header
      ><Card.Title>API Key</Card.Title><Card.Description
        >{m.ui_for_trusted_client_integrations_do_not_share_publicly()}</Card.Description
      ></Card.Header
    >
    <Card.Content class="flex flex-col gap-3">
      {#if apiKey}<div class="flex gap-2">
          <Input value={apiKey} readonly class="font-mono" /><Button
            variant="outline"
            size="icon"
            onclick={() => onCopy(apiKey)}
            aria-label={m.ui_copy_api_key()}><Copy data-icon /></Button
          >
        </div>{/if}
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" onclick={onRevealApiKey} disabled={busy === "api-key"}
          ><KeyRound data-icon="inline-start" />{apiKey
            ? m.ui_reload()
            : m.ui_show_api_key()}</Button
        ><Button variant="outline" onclick={onRotateApiKey} disabled={busy === "api-key"}
          ><RefreshCw data-icon="inline-start" />{m.ui_rotate()}</Button
        >
      </div>
    </Card.Content>
  </Card.Root>
</div>
