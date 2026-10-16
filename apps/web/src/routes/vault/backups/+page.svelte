<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { AlertCircle, ArrowLeft, Check, Database, Lock, Settings2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import BackupDestinationForm from "$lib/components/backup/BackupDestinationForm.svelte";
  import BackupDestinationList from "$lib/components/backup/BackupDestinationList.svelte";
  import RemoteBackupManager from "$lib/components/backup/RemoteBackupManager.svelte";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import {
    applyBackupDestinationForm,
    backupDestinationToForm,
    createDefaultBackupDestinationForm,
  } from "$lib/components/backup/destination-form";
  import LocalBackupPanel from "$lib/components/backup/LocalBackupPanel.svelte";
  import type { BackupDestinationRecord, BackupSettings } from "$lib/components/backup/types";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import {
    exportBackupLocalApi,
    fetchBackupSettingsApi,
    importBackupLocalApi,
    runBackupApi,
    updateBackupSettingsApi,
  } from "$lib/services/api-backup";
  import { vault } from "$lib/stores/vault.svelte";

  // UI State
  let loading = $state(true);
  let saving = $state(false);
  let running = $state(false);
  let restoring = $state(false);
  let error = $state("");
  let successMsg = $state("");

  // Settings data
  let settings = $state<BackupSettings>({ destinations: [] });
  let selectedDestId = $state<string | null>(null);

  let form = $state(createDefaultBackupDestinationForm());

  // Local backups forms
  let localFile = $state<File | undefined>();
  let replaceExisting = $state(false);
  let allowChecksumMismatch = $state(false);
  let deleteConfirmOpen = $state(false);
  let restoreConfirmOpen = $state(false);
  let restoreConfirmation = $state("");

  function errorMessage(value: unknown, fallback: string) {
    return value instanceof Error && value.message ? value.message : fallback;
  }

  onMount(async () => {
    if (vault.profile?.role === "admin") {
      await loadBackupSettings();
    } else {
      loading = false;
    }
  });

  async function loadBackupSettings() {
    loading = true;
    error = "";
    try {
      const res = await fetchBackupSettingsApi();
      settings = res;
      if (settings.destinations.length > 0) {
        selectDestination(settings.destinations[0].id);
      } else {
        selectedDestId = null;
      }
    } catch (caught) {
      error = errorMessage(caught, m.ui_unable_to_load_backup_settings_refresh_and_try_again());
    } finally {
      loading = false;
    }
  }

  function selectDestination(id: string) {
    selectedDestId = id;
    const dest = settings.destinations.find((d) => d.id === id);
    if (!dest) return;

    form = backupDestinationToForm(dest);
  }

  function addDestination() {
    const newId = `backup-${Date.now().toString(36)}`;
    const newDest: BackupDestinationRecord = {
      id: newId,
      name: m.ui_new_backup_destination(),
      type: "r2",
      includeAttachments: false,
      destination: { rootPath: "backups" },
      schedule: {
        enabled: false,
        intervalHours: 24,
        startTime: "03:00",
        timezone: "UTC",
        retentionCount: 30,
      },
      runtime: {
        lastAttemptAt: null,
        lastAttemptLocalDate: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastUploadedFileName: null,
        lastUploadedSizeBytes: null,
        lastUploadedDestination: null,
      },
    };

    settings.destinations = [...settings.destinations, newDest];
    selectDestination(newId);
  }

  async function saveSettings() {
    if (!selectedDestId) return;
    saving = true;
    error = "";
    successMsg = "";

    try {
      const destIndex = settings.destinations.findIndex((d) => d.id === selectedDestId);
      if (destIndex === -1) throw new Error("Destination not found");

      settings.destinations[destIndex] = applyBackupDestinationForm(
        settings.destinations[destIndex],
        form,
      );

      const res = await updateBackupSettingsApi(settings);
      settings = res;
      showSuccess(m.ui_backup_settings_saved());
      selectDestination(selectedDestId);
    } catch (caught) {
      error = errorMessage(caught, m.ui_unable_to_save_backup_settings_check_the_configuration());
    } finally {
      saving = false;
    }
  }

  async function triggerBackup() {
    if (!selectedDestId) return;
    running = true;
    error = "";
    successMsg = "";
    try {
      const res = await runBackupApi(selectedDestId);
      settings = res.settings;
      showSuccess(m.ui_backup_completed_uploaded_value({ value0: res.result.fileName }));
      selectDestination(selectedDestId);
    } catch (caught) {
      error = errorMessage(
        caught,
        m.ui_backup_failed_check_your_storage_configuration_and_connection(),
      );
    } finally {
      running = false;
    }
  }

  async function deleteDestination() {
    if (!selectedDestId) return;

    saving = true;
    error = "";
    try {
      settings.destinations = settings.destinations.filter((d) => d.id !== selectedDestId);
      const res = await updateBackupSettingsApi(settings);
      settings = res;
      showSuccess(m.ui_deleted_successfully());
      if (settings.destinations.length > 0) {
        selectDestination(settings.destinations[0].id);
      } else {
        selectedDestId = null;
      }
    } catch (caught) {
      error = errorMessage(caught, m.ui_unable_to_delete_backup_destination());
    } finally {
      saving = false;
    }
  }

  async function handleLocalExport() {
    try {
      const blob = await exportBackupLocalApi(form.includeAttachments);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `edgewarden_local_backup_${ts}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showSuccess(m.ui_local_backup_created_and_downloaded());
    } catch (caught) {
      error = errorMessage(caught, m.ui_unable_to_create_local_backup());
    }
  }

  function requestLocalImport() {
    if (!localFile) {
      error = m.ui_select_a_backup_zip_file_first();
      return;
    }
    restoreConfirmation = "";
    restoreConfirmOpen = true;
  }

  async function handleLocalImport() {
    if (!localFile || restoreConfirmation !== "REVERT") return;
    restoreConfirmOpen = false;
    restoring = true;
    error = "";
    try {
      await importBackupLocalApi(localFile, replaceExisting, allowChecksumMismatch);
      if (replaceExisting) {
        showSuccess(m.ui_restore_completed_please_log_in_again());
        goto("/login");
      } else {
        showSuccess(m.ui_backup_imported_all_non_conflicting_data_has_been_added());
        localFile = undefined;
      }
    } catch (caught) {
      error = errorMessage(caught, m.ui_unable_to_import_local_backup());
    } finally {
      restoring = false;
    }
  }

  function showSuccess(msg: string) {
    successMsg = msg;
    error = "";
    setTimeout(() => {
      if (successMsg === msg) successMsg = "";
    }, 5000);
  }
</script>

<svelte:head>
  <title>{m.ui_backups_edgewarden()}</title>
</svelte:head>

<VaultPageShell
  title={m.nav_backups()}
  description={m.ui_manage_encrypted_backups_of_your_entire_instance()}
>
  <!-- Alerts -->
  {#if error}
    <Alert.Root variant="destructive"
      ><AlertCircle /><Alert.Title>{m.ui_action_failed()}</Alert.Title><Alert.Description
        >{error}</Alert.Description
      ></Alert.Root
    >
  {/if}

  {#if successMsg}
    <Alert.Root
      ><Check /><Alert.Title>{m.ui_action_completed()}</Alert.Title><Alert.Description
        >{successMsg}</Alert.Description
      ></Alert.Root
    >
  {/if}

  <!-- Main Layout -->
  {#if vault.profile?.role !== "admin"}
    <Empty.Root class="mx-auto my-12 max-w-md"
      ><Empty.Header
        ><Empty.Media variant="icon"><Lock /></Empty.Media><Empty.Title
          >{m.ui_administrator_access_required()}</Empty.Title
        ><Empty.Description
          >{m.ui_only_instance_administrators_can_configure_and_run_full_database_backups()}</Empty.Description
        ></Empty.Header
      ><Empty.Content
        ><Button variant="outline" onclick={() => goto("/vault")}>{m.ui_back_to_vault()}</Button
        ></Empty.Content
      ></Empty.Root
    >
  {:else if loading}
    <Empty.Root class="flex-1"
      ><Empty.Header
        ><Empty.Media><Spinner class="size-8" /></Empty.Media><Empty.Title
          >{m.ui_loading_backup_settings()}</Empty.Title
        ></Empty.Header
      ></Empty.Root
    >
  {:else}
    <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-4">
      <!-- Left Column: Destinations list -->
      <div class="flex flex-col gap-4 lg:col-span-1">
        <BackupDestinationList
          destinations={settings.destinations}
          selectedId={selectedDestId}
          onAdd={addDestination}
          onSelect={selectDestination}
        />
        <LocalBackupPanel
          bind:file={localFile}
          bind:replaceExisting
          bind:allowChecksumMismatch
          {restoring}
          onExport={handleLocalExport}
          onImport={requestLocalImport}
        />
      </div>

      <!-- Right Column: Destination settings -->
      <div class="flex flex-col gap-6 lg:col-span-3">
        {#if !selectedDestId}
          <Empty.Root
            ><Empty.Header
              ><Empty.Media variant="icon"><Settings2 /></Empty.Media><Empty.Title
                >{m.ui_select_a_backup_destination()}</Empty.Title
              ><Empty.Description
                >{m.ui_choose_an_existing_destination_on_the_left_or_add_a_new_one()}</Empty.Description
              ></Empty.Header
            ></Empty.Root
          >
        {:else}
          {@const currentDest = settings.destinations.find((d) => d.id === selectedDestId)}

          <BackupDestinationForm
            bind:form
            {saving}
            onSave={saveSettings}
            onDelete={() => (deleteConfirmOpen = true)}
          />

          <RemoteBackupManager
            destinationId={selectedDestId}
            destination={currentDest}
            {running}
            {allowChecksumMismatch}
            onRun={triggerBackup}
            onSuccess={showSuccess}
            onError={(message) => {
              error = message;
              successMsg = "";
            }}
          />
        {/if}
      </div>
    </div>
  {/if}
</VaultPageShell>

<AlertDialog.Root bind:open={deleteConfirmOpen}>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_delete_backup_destination()}</AlertDialog.Title
      ><AlertDialog.Description
        >{m.ui_the_configuration_will_be_deleted_existing_remote_backup_files_will_remain()}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={deleteDestination}>{m.ui_confirm_deletion()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>

<AlertDialog.Root bind:open={restoreConfirmOpen}>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_confirm_backup_restore()}</AlertDialog.Title
      ><AlertDialog.Description
        >{m.ui_value_type_revert_to_continue({
          value0: replaceExisting
            ? m.ui_replace_mode_overwrites_accounts_and_encrypted_data_in_this_instance()
            : m.ui_merge_mode_imports_non_conflicting_data_from_the_backup(),
        })}</AlertDialog.Description
      ></AlertDialog.Header
    ><Field.Field data-invalid={restoreConfirmation.length > 0 && restoreConfirmation !== "REVERT"}
      ><Field.Label for="restore-confirmation">{m.ui_confirmation_text()}</Field.Label><Input
        id="restore-confirmation"
        bind:value={restoreConfirmation}
        autocomplete="off"
        aria-invalid={restoreConfirmation.length > 0 && restoreConfirmation !== "REVERT"}
        placeholder="REVERT"
      /></Field.Field
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        disabled={restoreConfirmation !== "REVERT"}
        onclick={handleLocalImport}>{m.ui_restore_backup()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>
