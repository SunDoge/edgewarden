<script lang="ts">
import {
	AlertCircle,
	ArrowLeft,
	Check,
	Database,
	Info,
	Lock,
	RefreshCw,
	Save,
	Server,
	Settings2,
	Trash2,
} from "@lucide/svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import BackupDestinationList from "$lib/components/backup/BackupDestinationList.svelte";
import LocalBackupPanel from "$lib/components/backup/LocalBackupPanel.svelte";
import RemoteBackupBrowser, {
	type RemoteBackupItem,
} from "$lib/components/backup/RemoteBackupBrowser.svelte";
import type {
	BackupDestinationRecord,
	BackupSettings,
} from "$lib/components/backup/types";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
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
import { formatFileSize } from "$lib/services/backup-display";
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

// Forms
let destName = $state("");
let destType = $state<"s3" | "webdav">("webdav");
let includeAttachments = $state(false);

// S3 connection fields
let s3Endpoint = $state("");
let s3Bucket = $state("");
let s3Region = $state("auto");
let s3AccessKeyId = $state("");
let s3SecretAccessKey = $state("");
let s3RootPath = $state("edgewarden");
let s3AddressingStyle = $state<"path-style" | "virtual-hosted-style">(
	"path-style",
);

// WebDAV connection fields
let davBaseUrl = $state("");
let davUsername = $state("");
let davPassword = $state("");
let davRemotePath = $state("edgewarden");

// Schedule settings
let scheduleEnabled = $state(false);
let scheduleInterval = $state(24);
let scheduleStartTime = $state("03:00");
let scheduleTimezone = $state("UTC");
let scheduleRetention = $state<number | null>(30);

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

	destName = dest.name;
	destType = dest.type;
	includeAttachments = dest.includeAttachments;

	if (dest.type === "s3") {
		s3Endpoint = dest.destination.endpoint || "";
		s3Bucket = dest.destination.bucket || "";
		s3Region = dest.destination.region || "auto";
		s3AccessKeyId = dest.destination.accessKeyId || "";
		s3SecretAccessKey = dest.destination.secretAccessKey || "";
		s3RootPath = dest.destination.rootPath || "edgewarden";
		s3AddressingStyle = dest.destination.addressingStyle || "path-style";
	} else {
		davBaseUrl = dest.destination.baseUrl || "";
		davUsername = dest.destination.username || "";
		davPassword = dest.destination.password || "";
		davRemotePath = dest.destination.remotePath || "edgewarden";
	}

	scheduleEnabled = dest.schedule.enabled;
	scheduleInterval = dest.schedule.intervalHours;
	scheduleStartTime = dest.schedule.startTime;
	scheduleTimezone = dest.schedule.timezone;
	scheduleRetention = dest.schedule.retentionCount;

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

		const destConfig: any =
			destType === "s3"
				? {
						endpoint: s3Endpoint.trim(),
						bucket: s3Bucket.trim(),
						addressingStyle: s3AddressingStyle,
						region: s3Region.trim(),
						accessKeyId: s3AccessKeyId.trim(),
						secretAccessKey: s3SecretAccessKey,
						rootPath: s3RootPath.trim(),
					}
				: {
						baseUrl: davBaseUrl.trim(),
						username: davUsername.trim(),
						password: davPassword,
						remotePath: davRemotePath.trim(),
					};

		const updatedDest: BackupDestinationRecord = {
			...settings.destinations[destIndex],
			name: destName.trim() || (destType === "s3" ? "S3 备份" : "WebDAV 备份"),
			type: destType,
			includeAttachments,
			destination: destConfig,
			schedule: {
				enabled: scheduleEnabled,
				intervalHours: scheduleInterval,
				startTime: scheduleStartTime,
				timezone: scheduleTimezone,
				retentionCount: scheduleRetention,
			},
		};

		settings.destinations[destIndex] = updatedDest;

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
		const blob = await exportBackupLocalApi(includeAttachments);
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
						
						<!-- Config Form Card -->
						<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
							<div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
								<div>
									<h2 class="text-base font-bold text-slate-900 dark:text-slate-50">备份服务配置</h2>
									<p class="text-xs text-slate-500">修改远程 WebDAV 或 S3 连接密钥及桶目录</p>
								</div>
								<div class="flex gap-2">
									<Button variant="ghost" size="sm" onclick={deleteDestination} disabled={saving} class="text-red-500 hover:text-red-600">
										<Trash2 class="size-4 mr-1.5" />
										删除目的地
									</Button>
									<Button size="sm" onclick={saveSettings} disabled={saving} class="gap-1.5">
										{#if saving}
											<RefreshCw class="size-3.5 animate-spin" />
										{:else}
											<Save class="size-3.5" />
										{/if}
										保存修改
									</Button>
								</div>
							</div>

							<!-- Generic fields -->
							<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div class="space-y-1.5">
									<label for="backup-name" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">目的地名称</label>
									<Input id="backup-name" type="text" bind:value={destName} placeholder="例如：我的 Nextcloud 备份" />
								</div>
								<div class="space-y-1.5">
									<label for="backup-type" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">存储协议</label>
									<select id="backup-type" bind:value={destType} class="w-full flex h-10 rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
										<option value="webdav">WebDAV 协议</option>
										<option value="s3">S3 兼容协议</option>
									</select>
								</div>
								<div class="md:col-span-2 flex items-center gap-2 pt-1.5">
									<input type="checkbox" id="attachments" bind:checked={includeAttachments} class="rounded text-primary focus:ring-primary" />
									<label for="attachments" class="text-xs text-slate-700 dark:text-slate-300 select-none cursor-pointer flex items-center gap-1.5">
										同时备份附件文件 (包含 KV/R2 中的文件)
										<Info class="size-3.5 text-slate-400" title="勾选后，备份流程将同步读取附件的二进制流文件放入 ZIP 压缩包。" />
									</label>
								</div>
							</div>

							<!-- WebDAV Protocol Fields -->
							{#if destType === "webdav"}
								<div class="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
									<h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">WebDAV 存储节点设置</h3>
									<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div class="md:col-span-2 space-y-1.5">
											<label for="dav-url" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">WebDAV 服务器基础 URL</label>
											<Input id="dav-url" type="url" bind:value={davBaseUrl} placeholder="https://nextcloud.example.com/remote.php/dav/files/username" />
										</div>
										<div class="space-y-1.5">
											<label for="dav-username" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">用户名</label>
											<Input id="dav-username" type="text" bind:value={davUsername} placeholder="用户名" />
										</div>
										<div class="space-y-1.5">
											<label for="dav-password" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">应用密码 / 访问密码</label>
											<Input id="dav-password" type="password" bind:value={davPassword} placeholder="密码 (密文显示)" />
										</div>
										<div class="space-y-1.5 md:col-span-2">
											<label for="dav-path" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">备份根目录</label>
											<Input id="dav-path" type="text" bind:value={davRemotePath} placeholder="edgewarden" />
										</div>
									</div>
								</div>
							{:else}
								<!-- S3 Protocol Fields -->
								<div class="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
									<h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">S3 兼容对象存储设置</h3>
									<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div class="md:col-span-2 space-y-1.5">
											<label for="s3-endpoint" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Endpoint 端点 URL</label>
											<Input id="s3-endpoint" type="url" bind:value={s3Endpoint} placeholder="https://s3.us-east-1.amazonaws.com" />
										</div>
										<div class="space-y-1.5">
											<label for="s3-bucket" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Bucket 存储桶</label>
											<Input id="s3-bucket" type="text" bind:value={s3Bucket} placeholder="my-edgewarden-backups" />
										</div>
										<div class="space-y-1.5">
											<label for="s3-region" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Region 区域</label>
											<Input id="s3-region" type="text" bind:value={s3Region} placeholder="auto" />
										</div>
										<div class="space-y-1.5">
											<label for="s3-access-key" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Access Key ID</label>
											<Input id="s3-access-key" type="text" bind:value={s3AccessKeyId} placeholder="Access Key ID" />
										</div>
										<div class="space-y-1.5">
											<label for="s3-secret-key" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Secret Access Key</label>
											<Input id="s3-secret-key" type="password" bind:value={s3SecretAccessKey} placeholder="Secret Access Key" />
										</div>
										<div class="space-y-1.5">
											<label for="s3-addressing" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Addressing Style 地址模式</label>
											<select id="s3-addressing" bind:value={s3AddressingStyle} class="w-full flex h-10 rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
												<option value="path-style">Path Style (路径风格模式)</option>
												<option value="virtual-hosted-style">Virtual Hosted Style (虚拟主机名模式)</option>
											</select>
										</div>
										<div class="space-y-1.5">
											<label for="s3-path" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">备份根目录</label>
											<Input id="s3-path" type="text" bind:value={s3RootPath} placeholder="edgewarden" />
										</div>
									</div>
								</div>
							{/if}

							<!-- Schedule Settings Section -->
							<div class="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
								<h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">定时自动备份设定 (Cron Trigger)</h3>
								<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
									<div class="md:col-span-3 flex items-center gap-2">
										<input type="checkbox" id="schedEnabled" bind:checked={scheduleEnabled} class="rounded text-primary focus:ring-primary" />
										<label for="schedEnabled" class="text-xs text-slate-700 dark:text-slate-300 select-none cursor-pointer font-semibold">
											启用此目的地的自动定时备份任务
										</label>
									</div>

									<div class="space-y-1.5">
										<label for="schedule-interval" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">备份执行间隔 (小时)</label>
										<Input id="schedule-interval" type="number" bind:value={scheduleInterval} min="1" max="99" disabled={!scheduleEnabled} />
									</div>

									<div class="space-y-1.5">
										<label for="schedule-time" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">每日首发启动时间</label>
										<Input id="schedule-time" type="text" bind:value={scheduleStartTime} placeholder="03:00" disabled={!scheduleEnabled} />
									</div>

									<div class="space-y-1.5">
										<label for="schedule-retention" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">最大保留历史文件数 (Retention)</label>
										<Input id="schedule-retention" type="number" bind:value={scheduleRetention} placeholder="30" disabled={!scheduleEnabled} />
									</div>
								</div>
							</div>
						</div>

						<!-- Actions & Runtime State Card -->
						<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
							<div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
								<div>
									<h2 class="text-base font-bold text-slate-900 dark:text-slate-50">备份任务状态</h2>
									<p class="text-xs text-slate-500">查看最后一次备份触发运行的结果和时间</p>
								</div>
								<Button size="sm" onclick={triggerBackup} disabled={running} class="gap-1.5 bg-primary hover:bg-primary/95 text-white">
									{#if running}
										<RefreshCw class="size-3.5 animate-spin" />
										正在备份上传...
									{:else}
										<Server class="size-3.5" />
										立即执行备份
									{/if}
								</Button>
							</div>
							<div class="flex items-center gap-2 text-xs"><Button variant="outline" size="sm" onclick={openParentDirectory} disabled={!currentRemotePath || browsing}>上一级</Button><code class="rounded bg-muted px-2 py-1">/{currentRemotePath}</code></div>

							<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
								<div class="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/50">
									<span class="text-slate-500">上次运行时间：</span>
									<span class="font-medium text-slate-900 dark:text-slate-100">
										{currentDest?.runtime.lastAttemptAt ? new Date(currentDest.runtime.lastAttemptAt).toLocaleString("zh-CN") : "从未运行"}
									</span>
								</div>
								<div class="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/50">
									<span class="text-slate-500">上次成功备份时间：</span>
									<span class="font-medium text-slate-900 dark:text-slate-100 text-emerald-600 dark:text-emerald-400">
										{currentDest?.runtime.lastSuccessAt ? new Date(currentDest.runtime.lastSuccessAt).toLocaleString("zh-CN") : "从未成功"}
									</span>
								</div>
								<div class="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/50 md:col-span-2">
									<span class="text-slate-500 font-medium">上次生成的文件名：</span>
									<span class="font-mono text-xs text-slate-800 dark:text-slate-200">
										{currentDest?.runtime.lastUploadedFileName || "--"}
									</span>
								</div>
								<div class="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/50">
									<span class="text-slate-500">备份文件大小：</span>
									<span class="font-medium text-slate-900 dark:text-slate-100">
									{formatFileSize(currentDest?.runtime.lastUploadedSizeBytes)}
									</span>
								</div>
								<div class="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/50">
									<span class="text-slate-500 font-medium">运行状态结果：</span>
									{#if currentDest?.runtime.lastErrorAt}
										<span class="text-red-500 text-xs font-semibold flex items-center gap-1 select-all">
											<AlertCircle class="size-3.5 shrink-0" />
											错误：{currentDest.runtime.lastErrorMessage}
										</span>
									{:else if currentDest?.runtime.lastSuccessAt}
										<span class="text-emerald-500 text-xs font-semibold flex items-center gap-0.5">
											<Check class="size-3.5" />
											正常
										</span>
									{:else}
										<span class="text-slate-400 text-xs font-medium">无状态信息</span>
									{/if}
								</div>
							</div>
						</div>

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
