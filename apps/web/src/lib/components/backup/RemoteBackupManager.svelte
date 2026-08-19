<script lang="ts">
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
      `下载备份文件失败：${error instanceof Error ? error.message : String(error)}`,
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
  restorePath = path;
  restoreConfirmation = "";
}

async function confirmRestore() {
  if (!restorePath || restoreConfirmation !== "REVERT") return;
  const path = restorePath;
  restorePath = null;
  restoring = true;
  try {
    await restoreRemoteBackupApi(
      destinationId,
      path,
      true,
      allowChecksumMismatch,
    );
    onSuccess("恢复成功，主数据库已替换，请重新登录账户。");
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

<AlertDialog.Root open={deletePath !== null} onOpenChange={(open) => { if (!open) deletePath = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>删除远程备份</AlertDialog.Title><AlertDialog.Description>确定要从远程服务器删除“{deletePath}”吗？此操作无法撤销。</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action class="bg-destructive text-destructive-foreground hover:bg-destructive/90" onclick={confirmRemove}>确认删除</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>

<AlertDialog.Root open={restorePath !== null} onOpenChange={(open) => { if (!open) restorePath = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>恢复远程备份</AlertDialog.Title><AlertDialog.Description>此操作会用该备份覆盖整个系统，包括其他用户和保险库条目。请输入 REVERT 继续。</AlertDialog.Description></AlertDialog.Header><Field.Field data-invalid={restoreConfirmation.length > 0 && restoreConfirmation !== "REVERT"}><Field.Label for="remote-restore-confirmation">确认文本</Field.Label><Input id="remote-restore-confirmation" bind:value={restoreConfirmation} aria-invalid={restoreConfirmation.length > 0 && restoreConfirmation !== "REVERT"} autocomplete="off" placeholder="REVERT" /></Field.Field><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><Button variant="destructive" disabled={restoreConfirmation !== "REVERT"} onclick={confirmRestore}>恢复备份</Button></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
