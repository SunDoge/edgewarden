<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Download } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";

  let {
    file = $bindable(),
    replaceExisting = $bindable(),
    allowChecksumMismatch = $bindable(),
    restoring,
    onExport,
    onImport,
  }: {
    file: File | undefined;
    replaceExisting: boolean;
    allowChecksumMismatch: boolean;
    restoring: boolean;
    onExport: () => void;
    onImport: () => void;
  } = $props();
</script>

<Card.Root>
  <Card.Header
    ><Card.Title>{m.ui_manual_backup_and_restore()}</Card.Title><Card.Description
      >{m.ui_download_an_encrypted_backup_or_restore_an_existing_one()}</Card.Description
    ></Card.Header
  >
  <Card.Content
    ><Field.Group>
      <Button variant="outline" size="sm" onclick={onExport} class="w-full">
        <Download data-icon="inline-start" />{m.ui_export_local_backup_zip()}</Button
      >
      <Separator />
      <Field.Field>
        <Field.Label for="local-backup-file">{m.ui_restore_from_local_file()}</Field.Label>
        <Input
          id="local-backup-file"
          type="file"
          accept=".zip"
          onchange={(event) => (file = event.currentTarget.files?.[0])}
        />
      </Field.Field>
      <Field.FieldSet
        ><Field.FieldLegend>{m.ui_restore_options()}</Field.FieldLegend><Field.FieldGroup
          ><Field.Field orientation="horizontal"
            ><Checkbox id="replace-existing" bind:checked={replaceExisting} /><Field.Label
              for="replace-existing">{m.ui_replace_existing_data()}</Field.Label
            ></Field.Field
          ><Field.Field orientation="horizontal"
            ><Checkbox id="ignore-checksum" bind:checked={allowChecksumMismatch} /><Field.Label
              for="ignore-checksum">{m.ui_ignore_checksum_errors()}</Field.Label
            ></Field.Field
          ></Field.FieldGroup
        ></Field.FieldSet
      >
      <Button
        variant="outline"
        size="sm"
        onclick={onImport}
        disabled={!file || restoring}
        class="w-full"
      >
        {#if restoring}<Spinner
            data-icon="inline-start"
          />{m.ui_importing()}{:else}{m.ui_import_and_apply()}{/if}
      </Button>
    </Field.Group></Card.Content
  >
</Card.Root>
