<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { ArrowLeft, CheckCircle, Download, FileCode, ShieldAlert, Upload } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import { importCiphersApi } from "$lib/services/api-folders";
  import { errorDetail } from "$lib/services/error-message";
  import {
    buildBitwardenCsv,
    buildBitwardenJson,
    buildPlainExportDocument,
    deduplicateTransferDocument,
    encryptTransferDocument,
    type ImportDeduplicationResult,
    inspectEncryptedVaultImport,
    parseVaultImport,
    parseVaultImportFile,
    type TransferDocument,
  } from "$lib/services/vault-transfer";
  import { syncVaultData, vault } from "$lib/stores/vault.svelte";
  import { encryptPasswordProtectedExport } from "$lib/services/bitwarden-encrypted-export";

  let errorMsg = $state("");
  let successMsg = $state("");
  let importing = $state(false);
  let importProgress = $state(0);
  let importProgressLabel = $state("");
  let files = $state<FileList | undefined>();
  let importFormat = $state<"json" | "csv">("json");
  let exportFormat = $state<"encrypted_json" | "json" | "csv">("encrypted_json");
  let exportPassword = $state("");
  let exportPasswordConfirm = $state("");
  let pendingImport = $state<TransferDocument | null>(null);
  let deduplicationReview = $state<{
    original: TransferDocument;
    result: ImportDeduplicationResult;
  } | null>(null);
  let encryptedImport = $state(false);
  let importPassword = $state("");
  let exportConfirmOpen = $state(false);
  const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

  // Client-side export function
  async function handleExport() {
    errorMsg = "";
    successMsg = "";

    try {
      const exportData = buildPlainExportDocument(vault.folders, vault.ciphers);
      const plainJson = buildBitwardenJson(exportData);
      const content =
        exportFormat === "csv"
          ? buildBitwardenCsv(exportData)
          : exportFormat === "encrypted_json"
            ? await encryptPasswordProtectedExport(plainJson, exportPassword)
            : plainJson;
      const blob = new Blob([content], {
        type: exportFormat === "csv" ? "text/csv;charset=utf-8" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const extension = exportFormat === "csv" ? "csv" : "json";
      a.download = `edgewarden-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);

      successMsg =
        exportFormat === "encrypted_json"
          ? m.ui_password_protected_bitwarden_compatible_backup_downloaded_keep_the_export_passwo()
          : m.ui_unencrypted_backup_downloaded_keep_this_file_secure();
    } catch (caught) {
      errorMsg = m.ui_export_failed_value({ value0: errorDetail(caught) });
    }
  }

  async function prepareImport() {
    errorMsg = "";
    pendingImport = null;
    deduplicationReview = null;
    encryptedImport = false;
    importPassword = "";
    if (!files?.[0]) return;
    if (files[0].size > MAX_IMPORT_BYTES) {
      errorMsg = m.ui_import_files_must_not_exceed_32_mib();
      return;
    }
    try {
      const text = await files[0].text();
      if (importFormat === "json") {
        const encryptedType = inspectEncryptedVaultImport(text);
        if (encryptedType === "account-restricted")
          throw new Error(
            m.ui_account_restricted_json_cannot_be_imported_across_servers_use_a_password_protect(),
          );
        if (encryptedType === "password-protected") {
          encryptedImport = true;
          return;
        }
      }
      pendingImport = parseVaultImport(text, importFormat);
    } catch (e) {
      errorMsg = m.ui_unable_to_parse_file() + (e instanceof Error ? e.message : e);
    }
  }

  function resetImportSelection() {
    files = undefined;
    pendingImport = null;
    deduplicationReview = null;
    encryptedImport = false;
    importPassword = "";
    errorMsg = "";
  }

  // Client-side import function
  async function handleImport(strategy?: "skip" | "all") {
    errorMsg = "";
    successMsg = "";

    if (!files || files.length === 0) {
      errorMsg = m.ui_select_a_bitwarden_json_export_file_first();
      return;
    }

    importing = true;
    importProgress = 5;
    importProgressLabel = m.ui_reading_and_decrypting_export();
    try {
      const importedData =
        deduplicationReview?.original ??
        pendingImport ??
        (await parseVaultImportFile(await files[0].text(), importFormat, importPassword));
      if (importedData.folders.length === 0 && importedData.items.length === 0) {
        throw new Error(m.ui_no_folders_or_items_were_found_in_the_import_file());
      }

      if (!vault.symEncKey || !vault.symMacKey) {
        throw new Error(m.ui_encryption_keys_are_not_ready_unlock_your_vault_again());
      }

      const existingData = buildPlainExportDocument(
        vault.folders,
        vault.ciphers.filter((cipher) => !cipher.organizationId),
      );
      importProgress = 12;
      importProgressLabel = m.ui_checking_for_duplicates();
      const deduplicated =
        deduplicationReview?.result ?? deduplicateTransferDocument(importedData, existingData);
      if (
        strategy == null &&
        (deduplicated.duplicateItems > 0 || deduplicated.duplicateFolders > 0)
      ) {
        deduplicationReview = { original: importedData, result: deduplicated };
        importProgress = 12;
        importProgressLabel = m.ui_duplicate_check_complete_choose_how_to_proceed();
        return;
      }
      const documentToImport =
        strategy === "all" ? deduplicated.completeDocument : deduplicated.document;

      if (documentToImport.folders.length === 0 && documentToImport.items.length === 0) {
        successMsg = m.ui_nothing_imported_all_value_items_already_exist({
          value0: deduplicated.duplicateItems,
        });
        files = undefined;
        pendingImport = null;
        deduplicationReview = null;
        encryptedImport = false;
        importPassword = "";
        return;
      }

      importProgress = 15;
      importProgressLabel = m.ui_encrypting_imported_data();
      const encryptedPayload = await encryptTransferDocument(
        documentToImport,
        vault.symEncKey,
        vault.symMacKey,
        ({ processed, total, kind }) => {
          importProgress = total ? 15 + Math.round((processed / total) * 70) : 85;
          importProgressLabel = m.ui_encrypting_value_value_value({
            value0: kind === "folder" ? m.ui_folder() : m.ui_vault_items(),
            value1: processed,
            value2: total,
          });
        },
      );
      importProgress = 88;
      importProgressLabel = m.ui_uploading_encrypted_data();
      await importCiphersApi(encryptedPayload);

      // 4. Reload local vault data
      importProgress = 96;
      importProgressLabel = m.ui_syncing_vault();
      await syncVaultData();
      importProgress = 100;
      importProgressLabel = m.ui_import_complete();

      successMsg = m.ui_import_complete_folders_value_items_value({
        value0: encryptedPayload.folders.length,
        value1: encryptedPayload.ciphers.length,
      });
      files = undefined;
      pendingImport = null;
      deduplicationReview = null;
      encryptedImport = false;
      importPassword = "";
    } catch (caught) {
      errorMsg = m.ui_import_failed_value({ value0: errorDetail(caught) });
    } finally {
      importing = false;
    }
  }
</script>

<svelte:head>
  <title>{m.ui_import_and_export_edgewarden()}</title>
</svelte:head>

<VaultPageShell
  title={m.ui_import_and_export()}
  description={m.ui_move_vault_data_between_edgewarden_and_compatible_formats()}
  width="default"
>
  {#if errorMsg}
    <Alert.Root variant="destructive"
      ><ShieldAlert /><Alert.Title>{m.ui_action_failed()}</Alert.Title><Alert.Description
        >{errorMsg}</Alert.Description
      ></Alert.Root
    >
  {/if}

  {#if successMsg}
    <Alert.Root
      ><CheckCircle /><Alert.Title>{m.ui_action_completed()}</Alert.Title><Alert.Description
        >{successMsg}</Alert.Description
      ></Alert.Root
    >
  {/if}

  <div class="grid gap-4 md:grid-cols-2 md:gap-6">
    <!-- Import Panel -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-3">
          <div
            class="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Upload class="size-5" />
          </div>
          <div>
            <Card.Title>{m.ui_import_vault_data()}</Card.Title>
            <Card.Description>{m.ui_import_bitwarden_json_or_csv()}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content
        ><Field.Group>
          <Field.Field>
            <Field.Label>{m.ui_import_format()}</Field.Label>
            <div class="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
              <FileCode class="size-8 text-primary" />
              <div>
                <p class="text-sm font-medium">{m.ui_bitwarden_vault_export()}</p>
                <p class="text-xs text-muted-foreground">
                  {m.ui_supports_password_protected_json_unencrypted_json_and_csv()}
                </p>
              </div>
            </div>
          </Field.Field>

          <Field.Field
            ><Field.Label>{m.ui_file_format()}</Field.Label><Select.Root
              type="single"
              value={importFormat}
              onValueChange={(value) => {
                importFormat = value as "json" | "csv";
                resetImportSelection();
              }}
              ><Select.Trigger class="w-full"
                >{importFormat === "json"
                  ? m.ui_bitwarden_json_password_protected_or_unencrypted()
                  : "Bitwarden CSV"}</Select.Trigger
              ><Select.Content
                ><Select.Group
                  ><Select.Item value="json"
                    >{m.ui_bitwarden_json_password_protected_or_unencrypted()}</Select.Item
                  ><Select.Item value="csv">Bitwarden CSV</Select.Item></Select.Group
                ></Select.Content
              ></Select.Root
            ></Field.Field
          >

          <Field.Field>
            <Field.Label>{m.ui_choose_file()}</Field.Label>
            <Input
              type="file"
              accept={importFormat === "json" ? ".json,application/json" : ".csv,text/csv"}
              bind:files
              onchange={prepareImport}
              disabled={importing}
            />
          </Field.Field>

          {#if pendingImport}<div class="rounded-md border bg-muted p-3 text-xs">
              <p class="font-medium">{m.ui_import_preview()}</p>
              <p>
                {m.ui_folders_value_items_value({
                  value0: pendingImport.folders.length,
                  value1: pendingImport.items.length,
                })}
              </p>
              {#if pendingImport.warnings.length}<p class="mt-1 text-amber-600">
                  {m.ui_format_warnings_value({ value0: pendingImport.warnings.length })}
                </p>{/if}
            </div>{/if}
          {#if encryptedImport}<div transition:slide={{ duration: 160 }}>
              <Field.Field
                ><Field.Label for="import-password">{m.ui_encrypted_export_password()}</Field.Label
                ><Input
                  id="import-password"
                  type="password"
                  autocomplete="off"
                  bind:value={importPassword}
                  placeholder={m.ui_used_only_to_decrypt_in_your_browser()}
                /><Field.Description
                  >{m.ui_your_password_and_decrypted_content_are_not_sent_to_the_server()}</Field.Description
                ></Field.Field
              >
            </div>{/if}
          {#if deduplicationReview}
            <Alert.Root class="flex flex-col gap-3">
              <p class="font-semibold">{m.ui_duplicates_detected_before_import()}</p>
              <p>
                {m.ui_duplicate_items_value_reusable_folders_with_matching_names_value_choose_how_to_i(
                  {
                    value0: deduplicationReview.result.duplicateItems,
                    value1: deduplicationReview.result.duplicateFolders,
                  },
                )}
              </p>
              <div class="flex flex-col gap-2 sm:flex-row">
                <Button size="sm" disabled={importing} onclick={() => handleImport("skip")}
                  >{m.ui_skip_duplicates_and_import()}</Button
                >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importing}
                  onclick={() => handleImport("all")}>{m.ui_import_everything_anyway()}</Button
                >
              </div>
            </Alert.Root>
          {/if}

          <Button
            class="w-full bg-primary font-semibold py-2"
            disabled={importing ||
              !!deduplicationReview ||
              (!pendingImport && !(encryptedImport && importPassword))}
            onclick={() => handleImport()}
          >
            {#if importing}
              <Spinner data-icon="inline-start" />{m.ui_importing_and_encrypting_data()}{:else}
              <Upload data-icon="inline-start" />{m.ui_import_data()}{/if}
          </Button>
          {#if importing}
            <div
              class="flex flex-col gap-1.5"
              aria-live="polite"
              transition:slide={{ duration: 160 }}
            >
              <div class="flex justify-between text-xs text-muted-foreground">
                <span>{importProgressLabel}</span>
                <span>{importProgress}%</span>
              </div>
              <Progress value={importProgress} max={100} aria-label={importProgressLabel} />
            </div>
          {/if}
        </Field.Group></Card.Content
      >
    </Card.Root>

    <!-- Export Panel -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-3">
          <div
            class="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
          >
            <Download class="size-5" />
          </div>
          <div>
            <Card.Title>{m.ui_export_vault_data()}</Card.Title>
            <Card.Description>{m.ui_back_up_the_items_stored_in_your_vault()}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content
        ><Field.Group>
          <Field.Field
            ><Field.Label>{m.ui_export_format()}</Field.Label><Select.Root
              type="single"
              value={exportFormat}
              onValueChange={(value) => (exportFormat = value as "encrypted_json" | "json" | "csv")}
              ><Select.Trigger class="w-full"
                >{exportFormat === "encrypted_json"
                  ? m.ui_bitwarden_encrypted_json_password_protected()
                  : exportFormat === "json"
                    ? m.ui_bitwarden_json_unencrypted_full_export()
                    : m.ui_bitwarden_csv_unencrypted_logins_and_notes()}</Select.Trigger
              ><Select.Content
                ><Select.Group
                  ><Select.Item value="encrypted_json"
                    >{m.ui_bitwarden_encrypted_json_password_protected_recommended()}</Select.Item
                  ><Select.Item value="json"
                    >{m.ui_bitwarden_json_unencrypted_full_export()}</Select.Item
                  ><Select.Item value="csv"
                    >{m.ui_bitwarden_csv_unencrypted_logins_and_notes()}</Select.Item
                  ></Select.Group
                ></Select.Content
              ></Select.Root
            ></Field.Field
          >
          {#if exportFormat === "encrypted_json"}
            <Field.Field>
              <Field.Label for="export-password">{m.ui_export_password()}</Field.Label>
              <Input
                id="export-password"
                type="password"
                autocomplete="new-password"
                bind:value={exportPassword}
                placeholder={m.ui_required_to_restore_this_backup()}
              />
              <Field.Description
                >{m.ui_used_only_for_encryption_in_your_browser_the_server_cannot_recover_this_password()}</Field.Description
              >
            </Field.Field>
            <Field.Field>
              <Field.Label for="export-password-confirm"
                >{m.ui_confirm_export_password()}</Field.Label
              >
              <Input
                id="export-password-confirm"
                type="password"
                autocomplete="new-password"
                bind:value={exportPasswordConfirm}
              />
              {#if exportPasswordConfirm && exportPassword !== exportPasswordConfirm}
                <Field.Error>{m.ui_the_passwords_do_not_match()}</Field.Error>
              {/if}
            </Field.Field>
          {:else}
            <Alert.Root
              ><ShieldAlert /><Alert.Title>{m.ui_security_warning()}</Alert.Title><Alert.Description
                >{m.ui_this_export_contains_unencrypted_usernames_passwords_notes_and_payment_cards_do_()}</Alert.Description
              ></Alert.Root
            >
          {/if}
          <Separator />
          <Button
            variant={exportFormat === "encrypted_json" ? "default" : "destructive"}
            class="w-full"
            disabled={exportFormat === "encrypted_json" &&
              (!exportPassword || exportPassword !== exportPasswordConfirm)}
            onclick={() => (exportConfirmOpen = true)}
          >
            <Download data-icon="inline-start" />{m.ui_export_data()}</Button
          >
        </Field.Group></Card.Content
      >
    </Card.Root>
  </div>
</VaultPageShell>

<AlertDialog.Root bind:open={exportConfirmOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title
        >{exportFormat === "encrypted_json"
          ? m.ui_export_encrypted_vault()
          : m.ui_export_unencrypted_vault()}</AlertDialog.Title
      ><AlertDialog.Description
        >{exportFormat === "encrypted_json"
          ? m.ui_you_will_need_the_password_you_just_set_to_restore_this_file_edgewarden_cannot_r()
          : m.ui_anyone_with_this_unencrypted_file_can_read_its_passwords_store_it_securely_and_d()}</AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class={exportFormat === "encrypted_json"
          ? ""
          : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
        onclick={handleExport}>{m.ui_confirm_export()}</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>
