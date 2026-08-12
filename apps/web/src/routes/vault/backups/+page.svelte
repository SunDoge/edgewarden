<script lang="ts">
import {
	AlertCircle,
	ArrowLeft,
	Check,
	Database,
	Lock,
	RefreshCw,
	Settings2,
} from "@lucide/svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import BackupDestinationForm from "$lib/components/backup/BackupDestinationForm.svelte";
import BackupDestinationList from "$lib/components/backup/BackupDestinationList.svelte";
import BackupRuntimePanel from "$lib/components/backup/BackupRuntimePanel.svelte";
import {
	applyBackupDestinationForm,
	backupDestinationToForm,
	createDefaultBackupDestinationForm,
} from "$lib/components/backup/destination-form";
import LocalBackupPanel from "$lib/components/backup/LocalBackupPanel.svelte";
import RemoteBackupBrowser, {
	type RemoteBackupItem,
} from "$lib/components/backup/RemoteBackupBrowser.svelte";
import type {
	BackupDestinationRecord,
	BackupSettings,
} from "$lib/components/backup/types";
import { Button } from "$lib/components/ui/button/index.js";
import {
	deleteRemoteBackupApi,
	downloadRemoteBackupApi,
	exportBackupLocalApi,
	fetchBackupSettingsApi,
	importBackupLocalApi,
	inspectRemoteBackupApi,
	listRemoteBackupsApi,
	restoreRemoteBackupApi,
	runBackupApi,
	updateBackupSettingsApi,
} from "$lib/services/api";
import { vault } from "$lib/stores/vault.svelte";

// UI State
let loading = $state(true);
let saving = $state(false);
let running = $state(false);
let browsing = $state(false);
let downloading = $state<string | null>(null);
let restoring = $state(false);
let deleting = $state<string | null>(null);
let inspecting = $state<string | null>(null);
let error = $state("");
let successMsg = $state("");

// Settings data
let settings = $state<BackupSettings>({ destinations: [] });
let selectedDestId = $state<string | null>(null);

let form = $state(createDefaultBackupDestinationForm());

// Remote backup file browser
let remoteFiles = $state<RemoteBackupItem[]>([]);
let currentRemotePath = $state("");

// Local backups forms
let localFile = $state<File | null>(null);
let replaceExisting = $state(false);
let allowChecksumMismatch = $state(false);

onMount(async () => {
	if (!vault.isUnlocked) {
		goto("/vault/unlock");
		return;
	}
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
	} catch (e: any) {
		error = e.message || "无法加载备份配置，请刷新页面重试。";
	} finally {
		loading = false;
	}
}

function selectDestination(id: string) {
	selectedDestId = id;
	const dest = settings.destinations.find((d) => d.id === id);
	if (!dest) return;

	form = backupDestinationToForm(dest);

	// Load remote file browser
	currentRemotePath = "";
	remoteFiles = [];
	loadRemoteFiles();
}

async function loadRemoteFiles() {
	if (!selectedDestId) return;
	browsing = true;
	try {
		const list = await listRemoteBackupsApi(selectedDestId, currentRemotePath);
		remoteFiles = list.items || [];
	} catch (e: any) {
		console.warn("Failed to browse remote backups:", e);
		remoteFiles = [];
	} finally {
		browsing = false;
	}
}

function addDestination() {
	const newId = `backup-${Date.now().toString(36)}`;
	const newDest: BackupDestinationRecord = {
		id: newId,
		name: "新建备份目的地",
		type: "webdav",
		includeAttachments: false,
		destination: {
			baseUrl: "",
			username: "",
			password: "",
			remotePath: "edgewarden",
		},
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
	} catch (e: any) {
		error = e.message || "保存备份配置失败，请检查参数。";
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
	} catch (e: any) {
		error = e.message || "立即执行备份失败，请检查您的存储配置和连通性。";
	} finally {
		running = false;
	}
}

async function deleteDestination() {
	if (!selectedDestId) return;
	if (!confirm("您确定要删除此备份目的地吗？已存在的远程文件不会被删除。"))
		return;

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
	} catch (e: any) {
		error = e.message || "删除备份目的地失败。";
	} finally {
		saving = false;
	}
}

async function handleDownloadFile(path: string, fileName: string) {
	if (!selectedDestId) return;
	downloading = path;
	try {
		const blob = await downloadRemoteBackupApi(selectedDestId, path);
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	} catch (e: any) {
		alert("下载备份文件失败：" + (e.message || e));
	} finally {
		downloading = null;
	}
}

async function handleDeleteFile(path: string) {
	if (!selectedDestId) return;
	if (
		!confirm(`确定要从远程服务器删除此备份文件 "${path}" 吗？此操作无法撤销。`)
	)
		return;

	deleting = path;
	try {
		await deleteRemoteBackupApi(selectedDestId, path);
		await loadRemoteFiles();
		showSuccess("文件删除成功！");
	} catch (e: any) {
		alert("删除远程备份文件失败：" + (e.message || e));
	} finally {
		deleting = null;
	}
}

async function handleInspectFile(path: string) {
	if (!selectedDestId) return;
	inspecting = path;
	try {
		const result = await inspectRemoteBackupApi(selectedDestId, path);
		const integrity = result.integrity ?? {};
		if (integrity.matches === true || integrity.valid === true)
			showSuccess("备份文件校验和验证通过。");
		else error = integrity.reason || "备份文件校验和与文件名不匹配。";
	} catch (e: any) {
		error = e.message || "检查备份完整性失败。";
	} finally {
		inspecting = null;
	}
}

function openRemoteDirectory(path: string) {
	currentRemotePath = path;
	loadRemoteFiles();
}

function openParentDirectory() {
	const parts = currentRemotePath
		.replace(/\/+$/, "")
		.split("/")
		.filter(Boolean);
	parts.pop();
	openRemoteDirectory(parts.join("/"));
}

async function handleRestoreRemote(path: string) {
	if (!selectedDestId) return;
	const msg =
		"确定要从远程备份文件恢复吗？\n警告：此操作将使用该备份全量覆盖系统中的所有数据，包括其他用户和保险库条目！此操作不可逆！\n\n请在下方输入 REVERT 确认：";
	const confirmVal = prompt(msg);
	if (confirmVal !== "REVERT") {
		alert("操作已取消");
		return;
	}

	restoring = true;
	error = "";
	try {
		await restoreRemoteBackupApi(
			selectedDestId,
			path,
			true, // replaceExisting
			allowChecksumMismatch,
		);
		alert("恢复成功！由于主数据库已替换，请重新登录您的账户。");
		goto("/login");
	} catch (e: any) {
		error = e.message || "从远程备份恢复失败。";
	} finally {
		restoring = false;
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
	} catch (e: any) {
		error = e.message || "生成本地备份失败。";
	}
}

async function handleLocalImport() {
	if (!localFile) {
		alert("请先选择备份 zip 文件！");
		return;
	}

	const msg =
		"确定要从本地备份文件导入吗？\n警告：如果选择 [替换现有数据]，此操作将全量覆盖系统中的所有账户和加密数据！\n\n如果确认，请输入 REVERT：";
	const confirmVal = prompt(msg);
	if (confirmVal !== "REVERT") {
		alert("操作已取消");
		return;
	}

	restoring = true;
	error = "";
	try {
		await importBackupLocalApi(
			localFile,
			replaceExisting,
			allowChecksumMismatch,
		);
		if (replaceExisting) {
			alert("系统恢复成功！请重新登录您的账户。");
			goto("/login");
		} else {
			alert("备份导入成功！已导入备份中的所有非冲突数据。");
			localFile = null;
		}
	} catch (e: any) {
		error = e.message || "本地备份导入失败。";
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

<div class="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 flex flex-col">
	<div class="max-w-6xl w-full mx-auto space-y-6 flex-1 flex flex-col">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<Button variant="outline" size="icon" onclick={() => goto("/vault")} class="size-9">
					<ArrowLeft class="size-4" />
				</Button>
				<div>
					<h1 class="text-xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
						<Database class="size-5 text-primary" />
						云备份中心
					</h1>
					<p class="text-xs text-slate-500 mt-0.5">配置与管理整个密码库实例的安全备份，可导出为标准的端到端加密备份包</p>
				</div>
			</div>
		</div>

		<!-- Alerts -->
		{#if error}
			<div class="p-3.5 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-lg text-sm flex items-start gap-2">
				<AlertCircle class="size-4 shrink-0 mt-0.5" />
				<span>{error}</span>
			</div>
		{/if}

		{#if successMsg}
			<div class="p-3.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 rounded-lg text-sm flex items-start gap-2">
				<Check class="size-4 shrink-0 mt-0.5" />
				<span>{successMsg}</span>
			</div>
		{/if}

		<!-- Main Layout -->
		{#if vault.profile?.role !== "admin"}
			<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center max-w-md mx-auto space-y-4 my-12">
				<Lock class="size-12 mx-auto text-slate-400 dark:text-slate-600" />
				<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">仅限管理员访问</h2>
				<p class="text-sm text-slate-500">云备份中心是系统级管理面板，只有系统管理员账户能够配置和触发全量数据库备份。</p>
				<Button variant="outline" onclick={() => goto("/vault")} class="w-full">返回保险库</Button>
			</div>
		{:else if loading}
			<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center flex-1 flex flex-col items-center justify-center">
				<RefreshCw class="size-8 text-primary animate-spin mb-3" />
				<span class="text-sm text-slate-500">正在载入备份配置设置...</span>
			</div>
		{:else}
			<div class="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
				<!-- Left Column: Destinations list -->
				<div class="lg:col-span-1 space-y-4">
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
						onImport={handleLocalImport}
					/>
				</div>

				<!-- Right Column: Destination settings -->
				<div class="lg:col-span-3 space-y-6">
					{#if !selectedDestId}
						<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center text-slate-400">
							<Settings2 class="size-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
							<p class="font-medium text-sm">请在左侧选择或添加一个备份目的地</p>
						</div>
					{:else}
						{@const currentDest = settings.destinations.find(d => d.id === selectedDestId)}
						
						<BackupDestinationForm
							bind:form
							{saving}
							onSave={saveSettings}
							onDelete={deleteDestination}
						/>

						<BackupRuntimePanel
							destination={currentDest}
							currentPath={currentRemotePath}
							{running}
							{browsing}
							onRun={triggerBackup}
							onOpenParent={openParentDirectory}
						/>
						<RemoteBackupBrowser
							items={remoteFiles}
							{browsing}
							{downloading}
							{deleting}
							{inspecting}
							{restoring}
							onRefresh={loadRemoteFiles}
							onOpenDirectory={openRemoteDirectory}
							onInspect={handleInspectFile}
							onDownload={handleDownloadFile}
							onRestore={handleRestoreRemote}
							onDelete={handleDeleteFile}
						/>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
