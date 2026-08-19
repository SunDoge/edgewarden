<script lang="ts">
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

  let errorMsg = $state("");
  let successMsg = $state("");
  let importing = $state(false);
  let importProgress = $state(0);
  let importProgressLabel = $state("");
  let files = $state<FileList | undefined>();
  let importFormat = $state<"json" | "csv">("json");
  let exportFormat = $state<"json" | "csv">("json");
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
  function handleExport() {
    errorMsg = "";
    successMsg = "";

    try {
      const exportData = buildPlainExportDocument(vault.folders, vault.ciphers);
      const content =
        exportFormat === "csv" ? buildBitwardenCsv(exportData) : buildBitwardenJson(exportData);
      const blob = new Blob([content], {
        type: exportFormat === "csv" ? "text/csv;charset=utf-8" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `edgewarden-export-${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);

      successMsg = "导出成功！明文备份文件已下载。请妥善保存该文件。";
    } catch (caught) {
      errorMsg = `导出失败: ${errorDetail(caught)}`;
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
      errorMsg = "导入文件不能超过 32 MiB。";
      return;
    }
    try {
      const text = await files[0].text();
      if (importFormat === "json") {
        const encryptedType = inspectEncryptedVaultImport(text);
        if (encryptedType === "account-restricted")
          throw new Error("账户限制型加密 JSON 不能跨服务器导入，请改用密码保护型加密导出");
        if (encryptedType === "password-protected") {
          encryptedImport = true;
          return;
        }
      }
      pendingImport = parseVaultImport(text, importFormat);
    } catch (e) {
      errorMsg = "解析失败: " + (e instanceof Error ? e.message : e);
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
      errorMsg = "请先选择需要导入的 Bitwarden JSON 导出文件。";
      return;
    }

    importing = true;
    importProgress = 5;
    importProgressLabel = "正在读取并解密导出文件…";
    try {
      const importedData =
        deduplicationReview?.original ??
        pendingImport ??
        (await parseVaultImportFile(await files[0].text(), importFormat, importPassword));
      if (importedData.folders.length === 0 && importedData.items.length === 0) {
        throw new Error("导入的文件中没有发现任何文件夹或密码项。");
      }

      if (!vault.symEncKey || !vault.symMacKey) {
        throw new Error("加密密钥未就绪，请重新解锁保险库。");
      }

      const existingData = buildPlainExportDocument(
        vault.folders,
        vault.ciphers.filter((cipher) => !cipher.organizationId),
      );
      importProgress = 12;
      importProgressLabel = "正在检测重复条目…";
      const deduplicated =
        deduplicationReview?.result ?? deduplicateTransferDocument(importedData, existingData);
      if (
        strategy == null &&
        (deduplicated.duplicateItems > 0 || deduplicated.duplicateFolders > 0)
      ) {
        deduplicationReview = { original: importedData, result: deduplicated };
        importProgress = 12;
        importProgressLabel = "重复项检测完成，等待选择";
        return;
      }
      const documentToImport =
        strategy === "all" ? deduplicated.completeDocument : deduplicated.document;

      if (documentToImport.folders.length === 0 && documentToImport.items.length === 0) {
        successMsg = `没有导入数据：${deduplicated.duplicateItems} 个密码项均已存在。`;
        files = undefined;
        pendingImport = null;
        deduplicationReview = null;
        encryptedImport = false;
        importPassword = "";
        return;
      }

      importProgress = 15;
      importProgressLabel = "正在加密导入数据…";
      const encryptedPayload = await encryptTransferDocument(
        documentToImport,
        vault.symEncKey,
        vault.symMacKey,
        ({ processed, total, kind }) => {
          importProgress = total ? 15 + Math.round((processed / total) * 70) : 85;
          importProgressLabel = `正在加密${kind === "folder" ? "文件夹" : "密码项"} ${processed}/${total}…`;
        },
      );
      importProgress = 88;
      importProgressLabel = "正在上传加密数据…";
      await importCiphersApi(encryptedPayload);

      // 4. Reload local vault data
      importProgress = 96;
      importProgressLabel = "正在同步保险库…";
      await syncVaultData();
      importProgress = 100;
      importProgressLabel = "导入完成";

      successMsg = `导入成功！已成功导入 ${encryptedPayload.folders.length} 个文件夹和 ${encryptedPayload.ciphers.length} 个密码项。`;
      files = undefined;
      pendingImport = null;
      deduplicationReview = null;
      encryptedImport = false;
      importPassword = "";
    } catch (caught) {
      errorMsg = `导入失败: ${errorDetail(caught)}`;
    } finally {
      importing = false;
    }
  }
</script>

<svelte:head>
  <title>数据导入与导出 - Edgewarden</title>
</svelte:head>

<VaultPageShell
  title="数据导入与导出"
  description="在 Edgewarden 与兼容格式之间安全迁移保险库数据。"
  width="default"
>
  {#if errorMsg}
    <Alert.Root variant="destructive"
      ><ShieldAlert /><Alert.Title>操作失败</Alert.Title><Alert.Description
        >{errorMsg}</Alert.Description
      ></Alert.Root
    >
  {/if}

  {#if successMsg}
    <Alert.Root
      ><CheckCircle /><Alert.Title>操作成功</Alert.Title><Alert.Description
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
            <Card.Title>导入密码数据</Card.Title>
            <Card.Description>导入 Bitwarden JSON 或 CSV</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content
        ><Field.Group>
          <Field.Field>
            <Field.Label>导入格式</Field.Label>
            <div class="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
              <FileCode class="size-8 text-primary" />
              <div>
                <p class="text-sm font-medium">Bitwarden Vault 导出</p>
                <p class="text-xs text-muted-foreground">支持密码保护 JSON、未加密 JSON 和 CSV</p>
              </div>
            </div>
          </Field.Field>

          <Field.Field
            ><Field.Label>文件格式</Field.Label><Select.Root
              type="single"
              value={importFormat}
              onValueChange={(value) => {
                importFormat = value as "json" | "csv";
                resetImportSelection();
              }}
              ><Select.Trigger class="w-full"
                >{importFormat === "json"
                  ? "Bitwarden JSON（密码保护或未加密）"
                  : "Bitwarden CSV"}</Select.Trigger
              ><Select.Content
                ><Select.Group
                  ><Select.Item value="json">Bitwarden JSON（密码保护或未加密）</Select.Item
                  ><Select.Item value="csv">Bitwarden CSV</Select.Item></Select.Group
                ></Select.Content
              ></Select.Root
            ></Field.Field
          >

          <Field.Field>
            <Field.Label>选择文件</Field.Label>
            <Input
              type="file"
              accept={importFormat === "json" ? ".json,application/json" : ".csv,text/csv"}
              bind:files
              onchange={prepareImport}
              disabled={importing}
            />
          </Field.Field>

          {#if pendingImport}<div class="rounded-md border bg-muted p-3 text-xs">
              <p class="font-medium">导入预览</p>
              <p>{pendingImport.folders.length} 个文件夹，{pendingImport.items.length} 个条目</p>
              {#if pendingImport.warnings.length}<p class="mt-1 text-amber-600">
                  {pendingImport.warnings.length} 条格式警告
                </p>{/if}
            </div>{/if}
          {#if encryptedImport}<div transition:slide={{ duration: 160 }}>
              <Field.Field
                ><Field.Label for="import-password">加密导出密码</Field.Label><Input
                  id="import-password"
                  type="password"
                  autocomplete="off"
                  bind:value={importPassword}
                  placeholder="仅在浏览器内用于解密"
                /><Field.Description>密码和解密后的内容不会发送到服务器。</Field.Description
                ></Field.Field
              >
            </div>{/if}
          {#if deduplicationReview}
            <Alert.Root class="flex flex-col gap-3">
              <p class="font-semibold">写入前检测到重复内容</p>
              <p>
                已有或文件内重复密码项 {deduplicationReview.result.duplicateItems} 个，可复用的同名文件夹
                {deduplicationReview.result.duplicateFolders} 个。请选择本次导入方式：
              </p>
              <div class="flex flex-col gap-2 sm:flex-row">
                <Button size="sm" disabled={importing} onclick={() => handleImport("skip")}
                  >跳过重复项并导入</Button
                >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importing}
                  onclick={() => handleImport("all")}>仍然全部导入</Button
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
              <Spinner data-icon="inline-start" />
              正在导入并加密数据...
            {:else}
              <Upload data-icon="inline-start" />
              导入数据
            {/if}
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
            <Card.Title>导出密码数据</Card.Title>
            <Card.Description>备份您存储在保险库中的全部密码数据</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content
        ><Field.Group>
          <Field.Field
            ><Field.Label>导出格式</Field.Label><Select.Root
              type="single"
              value={exportFormat}
              onValueChange={(value) => (exportFormat = value as "json" | "csv")}
              ><Select.Trigger class="w-full"
                >{exportFormat === "json"
                  ? "Bitwarden JSON（完整）"
                  : "Bitwarden CSV（登录与笔记）"}</Select.Trigger
              ><Select.Content
                ><Select.Group
                  ><Select.Item value="json">Bitwarden JSON（完整）</Select.Item><Select.Item
                    value="csv">Bitwarden CSV（登录与笔记）</Select.Item
                  ></Select.Group
                ></Select.Content
              ></Select.Root
            ></Field.Field
          >
          <Alert.Root
            ><ShieldAlert /><Alert.Title>安全警告</Alert.Title><Alert.Description
              >导出的备份文件包含明文用户名、密码、笔记以及支付卡片。请勿发送给他人，用完后立即删除或存放于安全位置。</Alert.Description
            ></Alert.Root
          >
          <Separator />
          <Button variant="destructive" class="w-full" onclick={() => (exportConfirmOpen = true)}>
            <Download data-icon="inline-start" />
            导出数据
          </Button>
        </Field.Group></Card.Content
      >
    </Card.Root>
  </div>
</VaultPageShell>

<AlertDialog.Root bind:open={exportConfirmOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title>确认导出明文保险库</AlertDialog.Title><AlertDialog.Description
        >导出的文件不会加密，任何获得该文件的人都能读取其中的密码。请确认你能安全保存并在使用后删除它。</AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={handleExport}>确认导出</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>
