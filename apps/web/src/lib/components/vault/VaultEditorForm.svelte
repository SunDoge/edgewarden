<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { CipherType } from "@edgewarden/shared";
  import { Plus, ScanLine, Trash2 } from "@lucide/svelte";
  import { match } from "ts-pattern";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { scanTotpQrFile } from "$lib/services/totp-qr";
  import type { VaultEditorForm } from "$lib/services/vault-editor";

  interface FolderOption {
    id: string;
    name: string;
  }

  interface OrganizationOption {
    id: string;
    name: string;
  }

  interface CollectionOption {
    id: string;
    organizationId: string;
    name: string;
    readOnly?: boolean;
  }

  let {
    form = $bindable(),
    isCreating,
    isEditing,
    folders,
    organizations,
    collections,
    onSave,
    onDelete,
    onCancel,
  }: {
    form: VaultEditorForm;
    isCreating: boolean;
    isEditing: boolean;
    folders: FolderOption[];
    organizations: OrganizationOption[];
    collections: CollectionOption[];
    onSave: () => void;
    onDelete: () => void;
    onCancel: () => void;
  } = $props();

  let totpQrError = $state("");
  let totpQrInput = $state<HTMLInputElement | null>(null);

  function changeOwner() {
    form.folderId = null;
    form.collectionIds = [];
  }

  function toggleCollection(collectionId: string, checked: boolean) {
    form.collectionIds = checked
      ? [...new Set([...form.collectionIds, collectionId])]
      : form.collectionIds.filter((id) => id !== collectionId);
  }

  async function importTotpQr(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    totpQrError = "";
    try {
      form.loginTotp = await scanTotpQrFile(file);
    } catch (error) {
      totpQrError = error instanceof Error ? error.message : m.ui_unable_to_read_qr_code();
    }
  }

  function cipherTypeLabel(type: number): string {
    return match(type)
      .with(CipherType.Login, () => m.ui_login())
      .with(CipherType.SecureNote, () => m.ui_secure_note())
      .with(CipherType.Card, () => m.ui_card())
      .with(CipherType.Identity, () => m.ui_identity())
      .with(CipherType.SshKey, () => m.ui_ssh_key())
      .with(CipherType.BankAccount, () => m.ui_bank_account())
      .with(CipherType.DriversLicense, () => m.ui_driver_s_license())
      .with(CipherType.Passport, () => m.ui_passport())
      .otherwise(() => m.ui_login());
  }

  function uriMatchLabel(value: number | null): string {
    return match(value)
      .with(0, () => m.ui_base_domain())
      .with(1, () => m.ui_host())
      .with(2, () => m.ui_starts_with())
      .with(3, () => m.ui_exact())
      .with(4, () => m.ui_regular_expression())
      .with(5, () => m.ui_never())
      .otherwise(() => m.ui_default());
  }

  function customFieldTypeLabel(value: number): string {
    return match(value)
      .with(1, () => m.ui_hidden_2())
      .with(2, () => m.ui_boolean())
      .otherwise(() => m.ui_text());
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center justify-between">
    <h3 class="text-lg font-semibold text-foreground">
      {isCreating ? m.ui_new_item() : m.ui_edit_item()}
    </h3>
    <Button variant="ghost" size="sm" onclick={onCancel}>{m.login_cancel()}</Button>
  </div>

  <Separator />

  <Field.Group>
    {#if isCreating}
      <Field.Field
        ><Field.Label>{m.ui_item_type()}</Field.Label><Select.Root
          type="single"
          value={String(form.type)}
          onValueChange={(value) => (form.type = Number(value) as CipherType)}
          ><Select.Trigger class="w-full">{cipherTypeLabel(form.type)}</Select.Trigger
          ><Select.Content
            ><Select.Group
              ><Select.Item value={String(CipherType.Login)}>{m.ui_login()}</Select.Item
              ><Select.Item value={String(CipherType.SecureNote)}>{m.ui_secure_note()}</Select.Item
              ><Select.Item value={String(CipherType.Card)}>{m.ui_card()}</Select.Item><Select.Item
                value={String(CipherType.Identity)}>{m.ui_identity()}</Select.Item
              ><Select.Item value={String(CipherType.SshKey)}>{m.ui_ssh_key()}</Select.Item
              ><Select.Item value={String(CipherType.BankAccount)}
                >{m.ui_bank_account()}</Select.Item
              ><Select.Item value={String(CipherType.DriversLicense)}
                >{m.ui_driver_s_license()}</Select.Item
              ><Select.Item value={String(CipherType.Passport)}>{m.ui_passport()}</Select.Item
              ></Select.Group
            ></Select.Content
          ></Select.Root
        ></Field.Field
      >
    {/if}

    <Field.Field
      ><Field.Label for="cipher-name">{m.ui_item_name()}</Field.Label><Input
        id="cipher-name"
        bind:value={form.name}
        placeholder={m.ui_for_example_personal_email()}
      /></Field.Field
    >

    <Field.Field data-disabled={isEditing && Boolean(form.organizationId)}
      ><Field.Label>{m.ui_owner()}</Field.Label><Select.Root
        type="single"
        value={form.organizationId ?? "__personal"}
        disabled={isEditing && Boolean(form.organizationId)}
        onValueChange={(value) => {
          form.organizationId = value === "__personal" ? null : value;
          changeOwner();
        }}
        ><Select.Trigger class="w-full"
          >{form.organizationId
            ? (organizations.find((organization) => organization.id === form.organizationId)
                ?.name ?? m.ui_organization())
            : m.nav_vault()}</Select.Trigger
        ><Select.Content
          ><Select.Group
            ><Select.Item value="__personal">{m.nav_vault()}</Select.Item
            >{#each organizations as organization}<Select.Item value={organization.id}
                >{organization.name}</Select.Item
              >{/each}</Select.Group
          ></Select.Content
        ></Select.Root
      >{#if isEditing && !form.organizationId}<Field.Description
          >{m.ui_choosing_an_organization_re_encrypts_this_item_and_shares_it_with_the_selected_c()}</Field.Description
        >{/if}
      ></Field.Field
    >

    {#if form.organizationId}
      <Field.FieldSet
        ><Field.FieldLegend>{m.ui_collections()}</Field.FieldLegend><Field.FieldGroup>
          {#each collections.filter((collection) => collection.organizationId === form.organizationId) as collection}
            <Field.Field orientation="horizontal" data-disabled={Boolean(collection.readOnly)}
              ><Checkbox
                checked={form.collectionIds.includes(collection.id)}
                disabled={Boolean(collection.readOnly)}
                onCheckedChange={(checked) => toggleCollection(collection.id, checked)}
              /><Field.Label
                >{collection.name}{collection.readOnly ? m.ui_read_only_2() : ""}</Field.Label
              ></Field.Field
            >
          {/each}
        </Field.FieldGroup></Field.FieldSet
      >
    {:else}
      <Field.Field
        ><Field.Label>{m.ui_folder()}</Field.Label><Select.Root
          type="single"
          value={form.folderId ?? "__none"}
          onValueChange={(value) => (form.folderId = value === "__none" ? null : value)}
          ><Select.Trigger class="w-full"
            >{form.folderId
              ? (folders.find((folder) => folder.id === form.folderId)?.name ??
                m.ui_select_folder())
              : m.ui_none()}</Select.Trigger
          ><Select.Content
            ><Select.Group
              ><Select.Item value="__none">{m.ui_none()}</Select.Item
              >{#each folders as folder}<Select.Item value={folder.id}>{folder.name}</Select.Item
                >{/each}</Select.Group
            ></Select.Content
          ></Select.Root
        ></Field.Field
      >
    {/if}

    <Field.Field orientation="horizontal"
      ><Checkbox id="favorite" bind:checked={form.favorite} /><Field.Label for="favorite"
        >{m.ui_favorite()}</Field.Label
      ></Field.Field
    >

    {#if form.type === CipherType.Login}
      <Field.FieldSet class="border-t pt-4"
        ><Field.FieldLegend>{m.ui_login_details()}</Field.FieldLegend><Field.FieldGroup>
          <Field.Field
            ><Field.Label>{m.ui_username()}</Field.Label><Input
              bind:value={form.loginUsername}
              placeholder={m.ui_username()}
            /></Field.Field
          >
          <Field.Field
            ><Field.Label>{m.ui_password()}</Field.Label><Input
              type="password"
              bind:value={form.loginPassword}
              placeholder={m.ui_password()}
            /></Field.Field
          >
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <Field.Label>{m.ui_website_url()}</Field.Label><Button
                type="button"
                size="xs"
                variant="ghost"
                onclick={() => (form.loginUris = [...form.loginUris, { uri: "", match: null }])}
                ><Plus data-icon="inline-start" />{m.ui_add()}</Button
              >
            </div>
            {#each form.loginUris as uri, index}
              <div class="flex gap-2">
                <Input bind:value={uri.uri} placeholder="https://example.com" /><Select.Root
                  type="single"
                  value={uri.match == null ? "__default" : String(uri.match)}
                  onValueChange={(value) =>
                    (uri.match = value === "__default" ? null : Number(value))}
                  ><Select.Trigger class="w-28">{uriMatchLabel(uri.match)}</Select.Trigger
                  ><Select.Content
                    ><Select.Group
                      ><Select.Item value="__default">{m.ui_default()}</Select.Item><Select.Item
                        value="0">{m.ui_base_domain()}</Select.Item
                      ><Select.Item value="1">{m.ui_host()}</Select.Item><Select.Item value="2"
                        >{m.ui_starts_with()}</Select.Item
                      ><Select.Item value="3">{m.ui_exact()}</Select.Item><Select.Item value="4"
                        >{m.ui_regular_expression()}</Select.Item
                      ><Select.Item value="5">{m.ui_never()}</Select.Item></Select.Group
                    ></Select.Content
                  ></Select.Root
                >{#if form.loginUris.length > 1}<Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onclick={() =>
                      (form.loginUris = form.loginUris.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ))}
                    aria-label={m.ui_remove_url()}><Trash2 data-icon /></Button
                  >{/if}
              </div>
            {/each}
          </div>
          <Field.Field>
            <div class="flex items-center justify-between">
              <Field.Label>{m.ui_totp_key_otpauth_or_steam_uri()}</Field.Label><Button
                type="button"
                size="xs"
                variant="ghost"
                onclick={() => totpQrInput?.click()}
                ><ScanLine data-icon="inline-start" />{m.ui_scan_qr_code()}</Button
              >
            </div>
            <Input bind:value={form.loginTotp} autocomplete="off" />
            <input
              bind:this={totpQrInput}
              type="file"
              accept="image/*"
              class="hidden"
              onchange={importTotpQr}
            />
            {#if totpQrError}<p class="text-xs text-destructive" role="alert">{totpQrError}</p>{/if}
          </Field.Field>
        </Field.FieldGroup></Field.FieldSet
      >
    {/if}

    {#if form.type === CipherType.Card}
      <Field.FieldSet class="border-t pt-4"
        ><Field.FieldLegend>{m.ui_card()}</Field.FieldLegend><Field.FieldGroup
          ><Field.Field
            ><Field.Label>{m.ui_cardholder_name()}</Field.Label><Input
              bind:value={form.cardholderName}
              placeholder={m.ui_cardholder()}
            /></Field.Field
          ><Field.Field
            ><Field.Label>{m.ui_card_number()}</Field.Label><Input
              bind:value={form.cardNumber}
              placeholder={m.ui_card_number()}
            /></Field.Field
          ></Field.FieldGroup
        ></Field.FieldSet
      >
    {/if}

    {#if form.type >= CipherType.SshKey}
      <Field.Field class="border-t pt-4"
        ><Field.Label>{m.ui_type_specific_data_json()}</Field.Label><Textarea
          bind:value={form.extraData}
          rows={10}
          class="font-mono text-xs"
        /><Field.Description
          >{m.ui_each_string_in_this_object_is_encrypted_individually_before_being_sent()}</Field.Description
        ></Field.Field
      >
    {/if}

    <div class="flex flex-col gap-3 border-t pt-4">
      <div class="flex items-center justify-between">
        <Field.Label>{m.ui_custom_fields()}</Field.Label><Button
          type="button"
          size="xs"
          variant="ghost"
          onclick={() =>
            (form.customFields = [...form.customFields, { name: "", value: "", type: 0 }])}
          ><Plus data-icon="inline-start" />{m.ui_add()}</Button
        >
      </div>
      {#each form.customFields as field, index}
        <div class="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input bind:value={field.name} placeholder={m.ui_field_name()} /><Input
            bind:value={field.value}
            type={field.type === 1 ? "password" : "text"}
            placeholder={m.ui_field_value()}
          /><Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onclick={() =>
              (form.customFields = form.customFields.filter((_, itemIndex) => itemIndex !== index))}
            aria-label={m.ui_delete_field()}><Trash2 data-icon /></Button
          >
          <div class="col-span-2">
            <Select.Root
              type="single"
              value={String(field.type)}
              onValueChange={(value) => (field.type = Number(value))}
              ><Select.Trigger class="w-full">{customFieldTypeLabel(field.type)}</Select.Trigger
              ><Select.Content
                ><Select.Group
                  ><Select.Item value="0">{m.ui_text()}</Select.Item><Select.Item value="1"
                    >{m.ui_hidden_2()}</Select.Item
                  ><Select.Item value="2">{m.ui_boolean()}</Select.Item></Select.Group
                ></Select.Content
              ></Select.Root
            >
          </div>
        </div>
      {/each}
    </div>

    {#if form.type === CipherType.Identity}
      <Field.FieldSet class="border-t pt-4"
        ><Field.FieldLegend>{m.ui_identity()}</Field.FieldLegend><Field.FieldGroup
          ><div class="grid grid-cols-2 gap-2">
            <Field.Field
              ><Field.Label>{m.ui_last_name()}</Field.Label><Input
                bind:value={form.lastName}
                placeholder={m.ui_last_name()}
              /></Field.Field
            ><Field.Field
              ><Field.Label>{m.ui_first_name()}</Field.Label><Input
                bind:value={form.firstName}
                placeholder={m.ui_first_name()}
              /></Field.Field
            >
          </div>
          <Field.Field
            ><Field.Label>{m.ui_identification_number()}</Field.Label><Input
              bind:value={form.identityNumber}
              placeholder={m.ui_id_or_passport_number()}
            /></Field.Field
          ></Field.FieldGroup
        ></Field.FieldSet
      >
    {/if}

    <Field.Field class="border-t pt-4"
      ><Field.Label>{m.ui_notes_2()}</Field.Label><Textarea
        bind:value={form.notes}
        rows={4}
        placeholder={m.ui_enter_a_note()}
      /></Field.Field
    >
  </Field.Group>

  <div class="flex gap-2 pt-2">
    <Button onclick={onSave} class="flex-1">{m.ui_save()}</Button>
    {#if isEditing}<Button onclick={onDelete} variant="destructive">{m.ui_delete()}</Button>{/if}
  </div>
</div>
