<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Eye, EyeOff, File as FileIcon, FileText } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";

  let {
    isCreating,
    isEditing,
    form = $bindable(),
    hasExistingPassword,
    onSave,
    onCancel,
  }: {
    isCreating: boolean;
    isEditing: boolean;
    form: import("$lib/services/send-editor").SendEditorDraft;
    hasExistingPassword: boolean;
    onSave: () => void;
    onCancel: () => void;
  } = $props();

  let showPassword = $state(false);

  function handleFileChange(event: Event) {
    form.file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    if (form.file && !form.name) form.name = form.file.name;
  }
</script>

<div class="flex flex-col gap-5">
  <div class="flex items-center justify-between">
    <h3 class="text-lg font-semibold">{isCreating ? m.ui_new_send_2() : m.ui_edit_send()}</h3>
    <Button variant="ghost" size="sm" onclick={onCancel}>{m.login_cancel()}</Button>
  </div>
  <Separator />
  <Field.Group>
    {#if isCreating}<Field.Field
        ><Field.Label>{m.ui_send_type()}</Field.Label><ToggleGroup.Root
          type="single"
          variant="outline"
          class="grid w-full grid-cols-2"
          value={String(form.type)}
          onValueChange={(value) => {
            if (value) form.type = Number(value);
          }}
          ><ToggleGroup.Item value="0"
            ><FileText data-icon="inline-start" />{m.ui_encrypted_text()}</ToggleGroup.Item
          ><ToggleGroup.Item value="1"
            ><FileIcon data-icon="inline-start" />{m.ui_encrypted_file()}</ToggleGroup.Item
          ></ToggleGroup.Root
        ></Field.Field
      >{/if}
    <Field.Field
      ><Field.Label for="send-name">{m.ui_send_name()}</Field.Label><Input
        id="send-name"
        bind:value={form.name}
        placeholder={m.ui_for_example_financial_report_or_password_backup()}
      /></Field.Field
    >
    {#if form.type === 0}<Field.Field
        ><Field.Label for="send-content">{m.ui_text_content()}</Field.Label><Textarea
          id="send-content"
          bind:value={form.textContent}
          rows={6}
          placeholder={m.ui_enter_text_to_share_it_will_be_encrypted_on_your_device()}
        /></Field.Field
      >{:else if isCreating}<Field.Field
        ><Field.Label for="send-file">{m.ui_choose_file()}</Field.Label><Input
          id="send-file"
          type="file"
          onchange={handleFileChange}
        /></Field.Field
      >{/if}
    <Field.FieldSet class="border-t pt-4"
      ><Field.FieldLegend>{m.ui_security_and_expiration()}</Field.FieldLegend><Field.FieldGroup>
        <Field.Field
          ><Field.Label for="max-access-count">{m.ui_maximum_access_count()}</Field.Label><Input
            id="max-access-count"
            type="number"
            min="1"
            bind:value={form.maxAccessCount}
            placeholder={m.ui_leave_empty_for_unlimited_access()}
          /><Field.Description
            >{m.ui_the_link_stops_working_when_this_limit_is_reached()}</Field.Description
          ></Field.Field
        >
        <Field.Field
          ><Field.Label>{m.ui_deletion_date_2()}</Field.Label><Select.Root
            type="single"
            value={String(form.deletionDays)}
            onValueChange={(value) => (form.deletionDays = Number(value))}
            ><Select.Trigger class="w-full"
              >{m.ui_delete_after_value_days({ value0: form.deletionDays })}</Select.Trigger
            ><Select.Content
              ><Select.Group
                >{#each [1, 3, 7, 14, 30] as days}<Select.Item value={String(days)}
                    >{m.ui_delete_after_value_days({ value0: days })}</Select.Item
                  >{/each}</Select.Group
              ></Select.Content
            ></Select.Root
          ></Field.Field
        >
        <Field.Field
          ><Field.Label for="expiration-date">{m.ui_expiration_date()}</Field.Label><Input
            id="expiration-date"
            type="datetime-local"
            bind:value={form.expirationDate}
          /><Field.Description
            >{m.ui_access_stops_after_this_time_but_the_send_remains_manageable_until_deletion()}</Field.Description
          ></Field.Field
        >
        <Field.Field orientation="horizontal"
          ><Checkbox id="protect-send" bind:checked={form.protectWithPassword} /><Field.Label
            for="protect-send">{m.ui_require_an_access_password()}</Field.Label
          ></Field.Field
        >
        <Field.Field data-disabled={!form.protectWithPassword}
          ><Field.Label for="send-password">{m.ui_access_password()}</Field.Label>
          <div class="relative">
            <Input
              id="send-password"
              type={showPassword ? "text" : "password"}
              bind:value={form.password}
              placeholder={isEditing && hasExistingPassword
                ? m.ui_leave_empty_to_keep_the_current_password()
                : m.ui_enter_access_password()}
              disabled={!form.protectWithPassword}
              class="pr-10"
            /><Button
              type="button"
              variant="ghost"
              size="icon-xs"
              class="absolute right-1 top-1/2 -translate-y-1/2"
              onclick={() => (showPassword = !showPassword)}
              aria-label={showPassword ? m.login_hide_password() : m.login_show_password()}
              >{#if showPassword}<EyeOff data-icon />{:else}<Eye data-icon />{/if}</Button
            >
          </div></Field.Field
        >
        <Field.Field orientation="horizontal"
          ><Checkbox id="hideEmail" bind:checked={form.hideEmail} /><Field.Label for="hideEmail"
            >{m.ui_hide_my_email_address()}</Field.Label
          ></Field.Field
        >
        <Field.Field orientation="horizontal"
          ><Checkbox id="disabled" bind:checked={form.disabled} /><Field.Label for="disabled"
            >{m.ui_disable_this_link_now()}</Field.Label
          ></Field.Field
        >
      </Field.FieldGroup></Field.FieldSet
    >
  </Field.Group>
  <Button onclick={onSave} class="w-full"
    >{isCreating ? m.ui_create_encrypted_send() : m.ui_save_changes()}</Button
  >
</div>
