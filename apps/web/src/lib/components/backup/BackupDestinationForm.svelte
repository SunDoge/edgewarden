<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Info, Save, Trash2 } from "@lucide/svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import type { BackupDestinationForm } from "./destination-form";

  let {
    form = $bindable(),
    saving,
    onSave,
    onDelete,
  }: {
    form: BackupDestinationForm;
    saving: boolean;
    onSave: () => void;
    onDelete: () => void;
  } = $props();
</script>

<!-- Config Form Card -->
<Card.Root>
  <Card.Header class="flex-row items-start justify-between">
    <div>
      <Card.Title>{m.ui_backup_configuration()}</Card.Title><Card.Description
        >{m.ui_configure_a_native_r2_webdav_or_s3_backup_destination()}</Card.Description
      >
    </div>
    <Card.Action class="flex gap-2">
      <Button
        variant="ghost"
        size="sm"
        onclick={onDelete}
        disabled={saving}
        class="text-red-500 hover:text-red-600"
      >
        <Trash2 data-icon="inline-start" />{m.ui_delete_destination()}</Button
      >
      <Button size="sm" onclick={onSave} disabled={saving}>
        {#if saving}
          <Spinner data-icon="inline-start" />
        {:else}
          <Save data-icon="inline-start" />
        {/if}{m.ui_save_changes_2()}</Button
      >
    </Card.Action>
  </Card.Header>
  <Card.Content class="flex flex-col gap-6">
    <!-- Generic fields -->
    <Field.Group class="grid grid-cols-1 md:grid-cols-2">
      <Field.Field>
        <Field.Label for="backup-name">{m.ui_destination_name()}</Field.Label>
        <Input
          id="backup-name"
          type="text"
          bind:value={form.name}
          placeholder={m.ui_for_example_my_nextcloud_backup()}
        />
      </Field.Field>
      <Field.Field>
        <Field.Label>{m.ui_storage_protocol()}</Field.Label><Select.Root
          type="single"
          value={form.type}
          onValueChange={(value) => (form.type = value as typeof form.type)}
          ><Select.Trigger class="w-full"
            >{form.type === "r2"
              ? "Cloudflare R2"
              : form.type === "webdav"
                ? m.ui_webdav()
                : m.ui_s3_compatible()}</Select.Trigger
          ><Select.Content
            ><Select.Group
              ><Select.Item value="r2">Cloudflare R2</Select.Item><Select.Item value="webdav"
                >{m.ui_webdav()}</Select.Item
              ><Select.Item value="s3">{m.ui_s3_compatible()}</Select.Item></Select.Group
            ></Select.Content
          ></Select.Root
        >
      </Field.Field>
      <Field.Field class="md:col-span-2" orientation="horizontal">
        <Checkbox id="attachments" bind:checked={form.includeAttachments} />
        <Field.Label for="attachments" class="flex items-center gap-1.5"
          >{m.ui_include_attachments_and_file_sends_files_in_kv_r2()}<Info
            class="size-3.5 text-muted-foreground"
            title={m.ui_include_binary_attachment_and_send_files_in_the_zip_otherwise_file_sends_are_omi()}
          />
        </Field.Label>
      </Field.Field>
    </Field.Group>
    <Separator />

    <!-- WebDAV Protocol Fields -->
    {#if form.type === "r2"}
      <Alert.Root>
        <Info />
        <Alert.Title>{m.ui_use_the_worker_s_native_r2_storage()}</Alert.Title>
        <Alert.Description
          >{m.ui_backups_are_stored_under_backups_in_attachments_r2_with_no_extra_credentials_thi()}</Alert.Description
        >
      </Alert.Root>
    {:else if form.type === "webdav"}
      <Field.FieldSet>
        <Field.FieldLegend>{m.ui_webdav_settings()}</Field.FieldLegend>
        <Field.FieldGroup class="grid grid-cols-1 md:grid-cols-2">
          <Field.Field class="md:col-span-2">
            <Field.Label for="dav-url">{m.ui_webdav_base_url()}</Field.Label>
            <Input
              id="dav-url"
              type="url"
              bind:value={form.davBaseUrl}
              placeholder="https://nextcloud.example.com/remote.php/dav/files/username"
            />
          </Field.Field>
          <Field.Field>
            <Field.Label for="dav-username">{m.ui_username()}</Field.Label>
            <Input
              id="dav-username"
              type="text"
              bind:value={form.davUsername}
              placeholder={m.ui_username()}
            />
          </Field.Field>
          <Field.Field>
            <Field.Label for="dav-password">{m.ui_app_password_access_password()}</Field.Label>
            <Input
              id="dav-password"
              type="password"
              bind:value={form.davPassword}
              placeholder={m.ui_stored_password()}
            />
          </Field.Field>
          <Field.Field class="md:col-span-2">
            <Field.Label for="dav-path">{m.ui_backup_root_directory()}</Field.Label>
            <Input
              id="dav-path"
              type="text"
              bind:value={form.davRemotePath}
              placeholder="edgewarden"
            />
          </Field.Field>
        </Field.FieldGroup>
      </Field.FieldSet>
    {:else}
      <!-- S3 Protocol Fields -->
      <Field.FieldSet>
        <Field.FieldLegend>{m.ui_s3_compatible_storage_settings()}</Field.FieldLegend>
        <Field.FieldGroup class="grid grid-cols-1 md:grid-cols-2">
          <Field.Field class="md:col-span-2">
            <Field.Label for="s3-endpoint">{m.ui_endpoint_url()}</Field.Label>
            <Input
              id="s3-endpoint"
              type="url"
              bind:value={form.s3Endpoint}
              placeholder="https://s3.us-east-1.amazonaws.com"
            />
          </Field.Field>
          <Field.Field
            ><Field.Label for="s3-bucket">{m.ui_bucket()}</Field.Label>
            <Input
              id="s3-bucket"
              type="text"
              bind:value={form.s3Bucket}
              placeholder="my-edgewarden-backups"
            />
          </Field.Field>
          <Field.Field
            ><Field.Label for="s3-region">{m.ui_region_2()}</Field.Label>
            <Input id="s3-region" type="text" bind:value={form.s3Region} placeholder="auto" />
          </Field.Field>
          <Field.Field
            ><Field.Label for="s3-access-key">Access Key ID</Field.Label>
            <Input
              id="s3-access-key"
              type="text"
              bind:value={form.s3AccessKeyId}
              placeholder="Access Key ID"
            />
          </Field.Field>
          <Field.Field
            ><Field.Label for="s3-secret-key">Secret Access Key</Field.Label>
            <Input
              id="s3-secret-key"
              type="password"
              bind:value={form.s3SecretAccessKey}
              placeholder="Secret Access Key"
            />
          </Field.Field>
          <Field.Field
            ><Field.Label>{m.ui_addressing_style()}</Field.Label><Select.Root
              type="single"
              value={form.s3AddressingStyle}
              onValueChange={(value) =>
                (form.s3AddressingStyle = value as typeof form.s3AddressingStyle)}
              ><Select.Trigger class="w-full"
                >{form.s3AddressingStyle === "path-style"
                  ? m.ui_path_style()
                  : m.ui_virtual_hosted_style()}</Select.Trigger
              ><Select.Content
                ><Select.Group
                  ><Select.Item value="path-style">{m.ui_path_style()}</Select.Item><Select.Item
                    value="virtual-hosted-style">{m.ui_virtual_hosted_style()}</Select.Item
                  ></Select.Group
                ></Select.Content
              ></Select.Root
            ></Field.Field
          >
          <Field.Field
            ><Field.Label for="s3-path">{m.ui_backup_root_directory()}</Field.Label>
            <Input id="s3-path" type="text" bind:value={form.s3RootPath} placeholder="edgewarden" />
          </Field.Field>
        </Field.FieldGroup>
      </Field.FieldSet>
    {/if}

    <!-- Schedule Settings Section -->
    <Field.FieldSet>
      <Field.FieldLegend>{m.ui_automatic_backup_schedule_cron_trigger()}</Field.FieldLegend>
      <Field.FieldGroup class="grid grid-cols-1 md:grid-cols-3">
        <Field.Field class="md:col-span-3" orientation="horizontal">
          <Checkbox id="schedEnabled" bind:checked={form.scheduleEnabled} />
          <Field.Label for="schedEnabled"
            >{m.ui_enable_scheduled_backups_for_this_destination()}</Field.Label
          >
        </Field.Field>

        <Field.Field data-disabled={!form.scheduleEnabled}>
          <Field.Label for="schedule-interval">{m.ui_backup_interval_hours()}</Field.Label>
          <Input
            id="schedule-interval"
            type="number"
            bind:value={form.scheduleInterval}
            min="1"
            max="99"
            disabled={!form.scheduleEnabled}
          />
        </Field.Field>

        <Field.Field data-disabled={!form.scheduleEnabled}
          ><Field.Label>{m.ui_first_backup_hour_of_the_day()}</Field.Label><Select.Root
            type="single"
            value={form.scheduleStartTime}
            disabled={!form.scheduleEnabled}
            onValueChange={(value) => (form.scheduleStartTime = value)}
            ><Select.Trigger class="w-full">{form.scheduleStartTime}</Select.Trigger><Select.Content
              ><Select.Group
                >{#each Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`) as hour}<Select.Item
                    value={hour}>{hour}</Select.Item
                  >{/each}</Select.Group
              ></Select.Content
            ></Select.Root
          ><Field.Description
            >{m.ui_tasks_are_checked_hourly_and_run_within_the_selected_hour_not_at_an_exact_minute()}</Field.Description
          ></Field.Field
        >

        <Field.Field data-disabled={!form.scheduleEnabled}>
          <Field.Label for="schedule-retention">{m.ui_maximum_backup_files_to_keep()}</Field.Label>
          <Input
            id="schedule-retention"
            type="number"
            bind:value={form.scheduleRetention}
            placeholder="30"
            disabled={!form.scheduleEnabled}
          />
        </Field.Field>
      </Field.FieldGroup>
    </Field.FieldSet>
  </Card.Content>
</Card.Root>
