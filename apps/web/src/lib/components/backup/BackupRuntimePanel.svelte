<script lang="ts">
  import { formatDateTime } from "$lib/i18n/format";
  import * as m from "$lib/paraglide/messages.js";

  import { Server } from "@lucide/svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { formatFileSize } from "$lib/services/backup-display";
  import type { BackupDestinationRecord } from "./types";

  let {
    destination,
    currentPath,
    running,
    browsing,
    onRun,
    onOpenParent,
  }: {
    destination: BackupDestinationRecord | undefined;
    currentPath: string;
    running: boolean;
    browsing: boolean;
    onRun: () => void;
    onOpenParent: () => void;
  } = $props();
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.ui_backup_task_status()}</Card.Title>
    <Card.Description
      >{m.ui_view_the_time_and_result_of_the_latest_backup_attempt()}</Card.Description
    >
    <Card.Action
      ><Button size="sm" onclick={onRun} disabled={running}
        >{#if running}<Spinner data-icon="inline-start" />{m.ui_uploading_backup()}{:else}<Server
            data-icon="inline-start"
          />{m.ui_run_backup_now()}{/if}</Button
      ></Card.Action
    >
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    <div class="flex items-center gap-2 text-xs">
      <Button variant="outline" size="sm" onclick={onOpenParent} disabled={!currentPath || browsing}
        >{m.ui_back()}</Button
      ><code class="rounded bg-muted px-2 py-1">/{currentPath}</code>
    </div>
    <div class="grid grid-cols-1 gap-x-6 gap-y-3.5 text-sm md:grid-cols-2">
      <div class="flex justify-between border-b py-1">
        <span class="text-muted-foreground">{m.ui_last_attempt()}</span><span class="font-medium"
          >{destination?.runtime.lastAttemptAt
            ? formatDateTime(destination.runtime.lastAttemptAt)
            : m.ui_never_run()}</span
        >
      </div>
      <div class="flex justify-between border-b py-1">
        <span class="text-muted-foreground">{m.ui_last_successful_backup()}</span><span
          class="font-medium"
          >{destination?.runtime.lastSuccessAt
            ? formatDateTime(destination.runtime.lastSuccessAt)
            : m.ui_no_successful_backups()}</span
        >
      </div>
      <div class="flex justify-between border-b py-1 md:col-span-2">
        <span class="font-medium text-muted-foreground">{m.ui_last_file_name()}</span><span
          class="font-mono text-xs">{destination?.runtime.lastUploadedFileName || "--"}</span
        >
      </div>
      <div class="flex justify-between border-b py-1">
        <span class="text-muted-foreground">{m.ui_backup_size()}</span><span class="font-medium"
          >{formatFileSize(destination?.runtime.lastUploadedSizeBytes)}</span
        >
      </div>
      <div class="flex items-center justify-between border-b py-1">
        <span class="font-medium text-muted-foreground">{m.ui_result()}</span
        >{#if destination?.runtime.lastErrorAt}<Badge
            variant="destructive"
            class="max-w-[65%] truncate"
            title={destination.runtime.lastErrorMessage}
            >{m.ui_error_value({ value0: destination.runtime.lastErrorMessage ?? "" })}</Badge
          >{:else if destination?.runtime.lastSuccessAt}<Badge>{m.ui_active()}</Badge>{:else}<Badge
            variant="secondary">{m.ui_no_status_information()}</Badge
          >{/if}
      </div>
    </div>
  </Card.Content>
</Card.Root>
