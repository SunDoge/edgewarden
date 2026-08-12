<script lang="ts">
import { goto } from "$app/navigation";
import {
	deleteRemoteBackupApi,
	downloadRemoteBackupApi,
	inspectRemoteBackupApi,
	listRemoteBackupsApi,
	restoreRemoteBackupApi,
} from "$lib/services/api";
import BackupRuntimePanel from "./BackupRuntimePanel.svelte";
import RemoteBackupBrowser, {
	type RemoteBackupItem,
} from "./RemoteBackupBrowser.svelte";
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
			`下载备份文件失败：${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		downloading = null;
	}
}

async function remove(path: string) {
	if (
		!confirm(`确定要从远程服务器删除此备份文件 "${path}" 吗？此操作无法撤销。`)
	)
		return;
	deleting = path;
	try {
		await deleteRemoteBackupApi(destinationId, path);
		await load();
		onSuccess("文件删除成功！");
	} catch (error) {
		onError(
			`删除远程备份文件失败：${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		deleting = null;
	}
}

async function inspect(path: string) {
	inspecting = path;
	try {
		const integrity =
			(await inspectRemoteBackupApi(destinationId, path)).integrity ?? {};
		if (integrity.valid === true) {
			onSuccess("备份文件校验和与归档结构验证通过。");
		} else {
			onError(integrity.reason || "备份文件校验和与文件名不匹配。");
		}
	} catch (error) {
		onError(error instanceof Error ? error.message : "检查备份完整性失败。");
	} finally {
		inspecting = null;
	}
}

async function restore(path: string) {
	const confirmation = prompt(
		"确定要从远程备份文件恢复吗？\n警告：此操作将使用该备份全量覆盖系统中的所有数据，包括其他用户和保险库条目！此操作不可逆！\n\n请在下方输入 REVERT 确认：",
	);
	if (confirmation !== "REVERT") return;
	restoring = true;
	try {
		await restoreRemoteBackupApi(
			destinationId,
			path,
			true,
			allowChecksumMismatch,
		);
		alert("恢复成功！由于主数据库已替换，请重新登录您的账户。");
		await goto("/login");
	} catch (error) {
		onError(error instanceof Error ? error.message : "从远程备份恢复失败。");
	} finally {
		restoring = false;
	}
}
</script>

<BackupRuntimePanel
	{destination}
	currentPath={currentPath}
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
