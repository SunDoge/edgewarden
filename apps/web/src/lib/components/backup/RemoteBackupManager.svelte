<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { goto } from "$app/navigation";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    deleteRemoteBackupApi,
    downloadRemoteBackupApi,
    inspectRemoteBackupApi,
    listRemoteBackupsApi,
    restoreRemoteBackupApi,
  } from "$lib/services/api-backup";
  import BackupRuntimePanel from "./BackupRuntimePanel.svelte";
  import RemoteBackupBrowser from "./RemoteBackupBrowser.svelte";
  import type { RemoteBackupItem } from "$lib/services/backup-types";
  import type { BackupDestinationRecord } from "./types";

  let {
    destinationId,
    destination,
    running,
    allowChecksumMismatch,
    onRun,
    onSuccess,
    onError,
  }: {
    destinationId: string;
    destination: BackupDestinationRecord | undefined;
    running: boolean;
    allowChecksumMismatch: boolean;
    onRun: () => void;
    onSuccess: (message: string) => void;
    onError: (message: string) => void;
  } = $props();

  let items = $state<RemoteBackupItem[]>([]);
  let currentPath = $state("");
  let browsing = $state(false);
  let downloading = $state<string | null>(null);
  let deleting = $state<string | null>(null);
  let inspecting = $state<string | null>(null);
  let restoring = $state(false);
  let deletePath = $state<string | null>(null);
  let restorePath = $state<string | null>(null);
  let restoreConfirmation = $state("");

  async function load(id = destinationId, path = currentPath) {
    browsing = true;
    try {
      items = (await listRemoteBackupsApi(id, path)).items || [];
    } catch (error) {
      console.warn("Failed to browse remote backups:", error);
      items = [];
    } finally {
      browsing = false;
    }
  }

  $effect(() => {
    const id = destinationId;
    currentPath = "";
    void load(id, "");
  });

  function openDirectory(path: string) {
    currentPath = path;
    void load(destinationId, path);
  }

  function openParentDirectory() {
    const parts = currentPath.replace(/\/+$/, "").split("/").filter(Boolean);
    parts.pop();
    openDirectory(parts.join("/"));
  }

  async function download(path: string, fileName: string) {
    downloading = path;
    try {
      const blob = await downloadRemoteBackupApi(destinationId, path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      URL.revokeObjectURL(url);
      anchor.remove();
    } catch (error) {
      onError(
        m.ui_unable_to_download_backup_value({
          value0: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      downloading = null;
    }
  }

  async function remove(path: string) {
    deletePath = path;
  }

  async function confirmRemove() {
    if (!deletePath) return;
    const path = deletePath;
    deletePath = null;
    deleting = path;
    try {
      await deleteRemoteBackupApi(destinationId, path);
      await load();
      onSuccess(m.ui_file_deleted());
    } catch (error) {
      onError(
        m.ui_unable_to_delete_remote_backup_value({
          value0: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      deleting = null;
    }
  }

  async function inspect(path: string) {
    inspecting = path;
    try {
      const integrity = (await inspectRemoteBackupApi(destinationId, path)).integrity ?? {};
      if (integrity.valid === true) {
        onSuccess(m.ui_backup_checksum_and_archive_structure_verified());
      } else {
        onError(integrity.reason || m.ui_the_backup_checksum_does_not_match_its_file_name());
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : m.ui_unable_to_verify_backup_integrity());
    } finally {
      inspecting = null;
    }
  }

  async function restore(path: string) {
    restorePath = path;
    restoreConfirmation = "";
  }

  async function confirmRestore() {
    if (!restorePath || restoreConfirmation !== "REVERT") return;
    const path = restorePath;
    restorePath = null;
    restoring = true;
    try {
      await restoreRemoteBackupApi(destinationId, path, true, allowChecksumMismatch);
      onSuccess(m.ui_restore_completed_and_the_database_was_replaced_please_log_in_again());
      await goto("/login");
    } catch (error) {
      onError(error instanceof Error ? error.message : m.ui_unable_to_restore_remote_backup());
    } finally {
      restoring = false;
    }
  }
</script>

<BackupRuntimePanel
  {destination}
  {currentPath}
  {running}
  {browsing}
  {onRun}
  onOpenParent={openParentDirectory}
/>
<RemoteBackupBrowser
  {items}
  {browsing}
  {downloading}
  {deleting}
  {inspecting}
  {restoring}
  onRefresh={load}
  onOpenDirectory={openDirectory}
  onInspect={inspect}
  onDownload={download}
  onRestore={restore}
  onDelete={remove}
/>

<AlertDialog.Root
  open={deletePath !== null}
  onOpenChange={(open) => {
    if (!open) deletePath = null;
  }}
  ><AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_delete_remote_backup()}</AlertDialog.Title><AlertDialog.Description
        >{m.ui_delete_value_from_remote_storage_this_cannot_be_undone({
          value0: deletePath ?? "",
        })}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={confirmRemove}>{m.ui_confirm_deletion()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  ></AlertDialog.Root
>

<AlertDialog.Root
  open={restorePath !== null}
  onOpenChange={(open) => {
    if (!open) restorePath = null;
  }}
  ><AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_restore_remote_backup()}</AlertDialog.Title><AlertDialog.Description
        >{m.ui_this_replaces_the_entire_instance_with_the_backup_including_other_users_and_vaul()}</AlertDialog.Description
      ></AlertDialog.Header
    ><Field.Field data-invalid={restoreConfirmation.length > 0 && restoreConfirmation !== "REVERT"}
      ><Field.Label for="remote-restore-confirmation">{m.ui_confirmation_text()}</Field.Label><Input
        id="remote-restore-confirmation"
        bind:value={restoreConfirmation}
        aria-invalid={restoreConfirmation.length > 0 && restoreConfirmation !== "REVERT"}
        autocomplete="off"
        placeholder="REVERT"
      /></Field.Field
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><Button
        variant="destructive"
        disabled={restoreConfirmation !== "REVERT"}
        onclick={confirmRestore}>{m.ui_restore_backup()}</Button
      ></AlertDialog.Footer
    ></AlertDialog.Content
  ></AlertDialog.Root
>
