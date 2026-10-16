<script lang="ts">
  import { formatDateTime } from "$lib/i18n/format";
  import * as m from "$lib/paraglide/messages.js";

  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import { formatFileSize } from "$lib/services/backup-display";
  import type { RemoteBackupItem } from "$lib/services/backup-types";
  import {
    Download,
    FileArchive,
    Folder,
    Info,
    RefreshCw,
    ShieldCheck,
    Trash2,
  } from "@lucide/svelte";

  let {
    items,
    browsing,
    downloading,
    deleting,
    inspecting,
    restoring,
    onRefresh,
    onOpenDirectory,
    onInspect,
    onDownload,
    onRestore,
    onDelete,
  }: {
    items: RemoteBackupItem[];
    browsing: boolean;
    downloading: string | null;
    deleting: string | null;
    inspecting: string | null;
    restoring: boolean;
    onRefresh: () => void;
    onOpenDirectory: (path: string) => void;
    onInspect: (path: string) => void;
    onDownload: (path: string, name: string) => void;
    onRestore: (path: string) => void;
    onDelete: (path: string) => void;
  } = $props();
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.ui_remote_backups()}</Card.Title>
    <Card.Description
      >{m.ui_browse_archives_restore_a_backup_or_remove_old_files()}</Card.Description
    >
    <Card.Action
      ><Button
        size="icon-sm"
        variant="outline"
        onclick={onRefresh}
        disabled={browsing}
        aria-label={m.ui_refresh_remote_backups()}
        >{#if browsing}<Spinner />{:else}<RefreshCw />{/if}</Button
      ></Card.Action
    >
  </Card.Header>

  <Card.Content>
    <Table.Root>
      <Table.Header
        ><Table.Row
          ><Table.Head>{m.ui_file_name()}</Table.Head><Table.Head>{m.ui_file_size()}</Table.Head
          ><Table.Head>{m.ui_last_modified()}</Table.Head><Table.Head class="text-right"
            >{m.ui_actions()}</Table.Head
          ></Table.Row
        ></Table.Header
      >
      <Table.Body>
        {#each items as item (item.path)}
          <Table.Row>
            <Table.Cell class="font-mono text-xs"
              ><div class="flex items-center gap-2">
                {#if item.isDirectory}<Folder class="size-4 text-amber-500" />{:else}<FileArchive
                    class="size-4 text-primary/70"
                  />{/if}
                {#if item.isDirectory}<Button
                    variant="link"
                    class="h-auto p-0 font-mono text-xs"
                    onclick={() => onOpenDirectory(item.path)}>{item.name}</Button
                  >{:else}<span>{item.name}</span>{/if}
              </div></Table.Cell
            >
            <Table.Cell class="text-muted-foreground"
              >{item.isDirectory ? "--" : formatFileSize(item.size)}</Table.Cell
            >
            <Table.Cell class="text-xs text-muted-foreground"
              >{item.modifiedAt ? formatDateTime(item.modifiedAt) : "--"}</Table.Cell
            >
            <Table.Cell
              ><div class="flex items-center justify-end gap-1.5">
                {#if !item.isDirectory}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onclick={() => onInspect(item.path)}
                    disabled={inspecting === item.path}
                    aria-label={m.ui_verify_integrity()}
                    >{#if inspecting === item.path}<Spinner />{:else}<ShieldCheck />{/if}</Button
                  >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onclick={() => onDownload(item.path, item.name)}
                    disabled={downloading === item.path}
                    aria-label={m.ui_download_backup()}
                    >{#if downloading === item.path}<Spinner />{:else}<Download />{/if}</Button
                  >
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={() => onRestore(item.path)}
                    disabled={restoring}
                    >{#if restoring}<Spinner
                        data-icon="inline-start"
                      />{/if}{m.ui_restore_entire_instance()}</Button
                  >
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    onclick={() => onDelete(item.path)}
                    disabled={deleting === item.path}
                    aria-label={m.ui_delete_backup()}
                    >{#if deleting === item.path}<Spinner />{:else}<Trash2 />{/if}</Button
                  >
                {/if}
              </div></Table.Cell
            >
          </Table.Row>
        {/each}
        {#if items.length === 0}<Table.Row
            ><Table.Cell colspan={4}
              ><Empty.Root
                >{#if browsing}<Empty.Media variant="icon"><Spinner /></Empty.Media><Empty.Header
                    ><Empty.Title>{m.ui_retrieving_file_list()}</Empty.Title></Empty.Header
                  >{:else}<Empty.Media variant="icon"><Info /></Empty.Media><Empty.Header
                    ><Empty.Title>{m.ui_no_backup_files()}</Empty.Title><Empty.Description
                      >{m.ui_this_directory_is_empty_or_the_destination_does_not_grant_read_access()}</Empty.Description
                    ></Empty.Header
                  >{/if}</Empty.Root
              ></Table.Cell
            ></Table.Row
          >{/if}
      </Table.Body>
    </Table.Root>
  </Card.Content>
</Card.Root>
