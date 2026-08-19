<script lang="ts">
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Database,
  Lock,
  Settings2,
} from "@lucide/svelte";
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
import type {
  BackupDestinationRecord,
  BackupSettings,
} from "$lib/components/backup/types";
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
    error = errorMessage(caught, "无法加载备份配置，请刷新页面重试。");
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
    name: "新建备份目的地",
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
    const destIndex = settings.destinations.findIndex(
      (d) => d.id === selectedDestId,
    );
    if (destIndex === -1) throw new Error("Destination not found");

    settings.destinations[destIndex] = applyBackupDestinationForm(
      settings.destinations[destIndex],
      form,
    );

    const res = await updateBackupSettingsApi(settings);
    settings = res;
    showSuccess("备份设置保存成功！");
    selectDestination(selectedDestId);
  } catch (caught) {
    error = errorMessage(caught, "保存备份配置失败，请检查参数。");
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
    showSuccess(`备份执行成功！已上传文件: ${res.result.fileName}`);
    selectDestination(selectedDestId);
  } catch (caught) {
    error = errorMessage(
      caught,
      "立即执行备份失败，请检查您的存储配置和连通性。",
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
    settings.destinations = settings.destinations.filter(
      (d) => d.id !== selectedDestId,
    );
    const res = await updateBackupSettingsApi(settings);
    settings = res;
    showSuccess("删除成功！");
    if (settings.destinations.length > 0) {
      selectDestination(settings.destinations[0].id);
    } else {
      selectedDestId = null;
    }
  } catch (caught) {
    error = errorMessage(caught, "删除备份目的地失败。");
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
    showSuccess("本地备份已成功生成并下载。");
  } catch (caught) {
    error = errorMessage(caught, "生成本地备份失败。");
  }
}

function requestLocalImport() {
  if (!localFile) {
    error = "请先选择备份 ZIP 文件。";
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
    await importBackupLocalApi(
      localFile,
      replaceExisting,
      allowChecksumMismatch,
    );
    if (replaceExisting) {
      showSuccess("系统恢复成功，请重新登录账户。");
      goto("/login");
    } else {
      showSuccess("备份导入成功，已导入所有非冲突数据。");
      localFile = undefined;
    }
  } catch (caught) {
    error = errorMessage(caught, "本地备份导入失败。");
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
	<title>云备份中心 - Edgewarden</title>
</svelte:head>

<VaultPageShell title="云备份中心" description="配置与管理整个密码库实例的安全备份，可导出为标准的端到端加密备份包。">
		<!-- Alerts -->
		{#if error}
			<Alert.Root variant="destructive"><AlertCircle /><Alert.Title>操作失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>
		{/if}

		{#if successMsg}
			<Alert.Root><Check /><Alert.Title>操作成功</Alert.Title><Alert.Description>{successMsg}</Alert.Description></Alert.Root>
		{/if}

		<!-- Main Layout -->
		{#if vault.profile?.role !== "admin"}
			<Empty.Root class="mx-auto my-12 max-w-md"><Empty.Header><Empty.Media variant="icon"><Lock /></Empty.Media><Empty.Title>仅限管理员访问</Empty.Title><Empty.Description>云备份中心是系统级管理面板，只有系统管理员能够配置和触发全量数据库备份。</Empty.Description></Empty.Header><Empty.Content><Button variant="outline" onclick={() => goto("/vault")}>返回保险库</Button></Empty.Content></Empty.Root>
		{:else if loading}
			<Empty.Root class="flex-1"><Empty.Header><Empty.Media><Spinner class="size-8" /></Empty.Media><Empty.Title>正在载入备份配置</Empty.Title></Empty.Header></Empty.Root>
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
						<Empty.Root><Empty.Header><Empty.Media variant="icon"><Settings2 /></Empty.Media><Empty.Title>请选择备份目的地</Empty.Title><Empty.Description>在左侧选择已有目的地，或添加一个新目的地。</Empty.Description></Empty.Header></Empty.Root>
					{:else}
						{@const currentDest = settings.destinations.find(d => d.id === selectedDestId)}
						
						<BackupDestinationForm
							bind:form
							{saving}
							onSave={saveSettings}
							onDelete={() => deleteConfirmOpen = true}
						/>

						<RemoteBackupManager
							destinationId={selectedDestId}
							destination={currentDest}
							{running}
							{allowChecksumMismatch}
							onRun={triggerBackup}
							onSuccess={showSuccess}
							onError={(message) => { error = message; successMsg = ""; }}
						/>
					{/if}
				</div>
			</div>
		{/if}
</VaultPageShell>

<AlertDialog.Root bind:open={deleteConfirmOpen}>
	<AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>删除备份目的地</AlertDialog.Title><AlertDialog.Description>配置将被删除，但已经存在的远程备份文件不会被删除。</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action class="bg-destructive text-destructive-foreground hover:bg-destructive/90" onclick={deleteDestination}>确认删除</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={restoreConfirmOpen}>
	<AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>确认恢复备份</AlertDialog.Title><AlertDialog.Description>{replaceExisting ? "替换模式会覆盖系统中的账户与加密数据。" : "合并模式会导入备份中的非冲突数据。"} 请输入 REVERT 继续。</AlertDialog.Description></AlertDialog.Header><Field.Field data-invalid={restoreConfirmation.length > 0 && restoreConfirmation !== "REVERT"}><Field.Label for="restore-confirmation">确认文本</Field.Label><Input id="restore-confirmation" bind:value={restoreConfirmation} autocomplete="off" aria-invalid={restoreConfirmation.length > 0 && restoreConfirmation !== "REVERT"} placeholder="REVERT" /></Field.Field><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action disabled={restoreConfirmation !== "REVERT"} onclick={handleLocalImport}>恢复备份</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content>
</AlertDialog.Root>
