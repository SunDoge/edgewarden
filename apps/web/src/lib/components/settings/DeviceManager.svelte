<script lang="ts">
import { Pencil, Trash2 } from "@lucide/svelte";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Table from "$lib/components/ui/table/index.js";
import {
	deleteAllDevicesApi,
	deleteDeviceApi,
	deleteDevicesApi,
	fetchDevicesApi,
	renameDeviceApi,
} from "$lib/services/api-account";
import { getCurrentDeviceIdentifier } from "$lib/services/client-device";
import type { AccountDevice } from "$lib/services/account-types";

let {
	devices = $bindable(),
	passwordHash,
	onMessage,
	onError,
	onSessionRevoked,
}: {
	devices: AccountDevice[];
	passwordHash: (password: string) => Promise<string>;
	onMessage: (message: string) => void;
	onError: (error: unknown) => void;
	onSessionRevoked: (
		reason: "device-removed" | "devices-removed",
	) => Promise<void>;
} = $props();

let busy = $state("");
let editingDevice = $state<AccountDevice | null>(null);
let deviceName = $state("");
let removeAllOpen = $state(false);
let removeAllPassword = $state("");
let selectedIds = $state<Record<string, boolean>>({});
let removeTarget = $state<
	{ kind: "single"; device: AccountDevice } | { kind: "selected" } | null
>(null);
let selectedIdList = $derived(
	devices.filter((device) => selectedIds[device.id]).map((device) => device.id),
);

function startRename(device: AccountDevice) {
	editingDevice = device;
	deviceName = device.name ?? "";
}

async function saveDeviceName() {
	if (!editingDevice || !deviceName.trim()) return;
	busy = `device-${editingDevice.id}`;
	try {
		await renameDeviceApi(editingDevice.id, deviceName.trim());
		editingDevice = null;
		devices = (await fetchDevicesApi()).data;
		onMessage("设备名称已更新");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}

async function removeDevice(device: AccountDevice) {
	busy = `device-${device.id}`;
	try {
		await deleteDeviceApi(device.id);
		devices = devices.filter((item) => item.id !== device.id);
		if (device.id === getCurrentDeviceIdentifier()) {
			await onSessionRevoked("device-removed");
		}
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}

async function removeSelectedDevices() {
	if (!selectedIdList.length) return;
	const removesCurrent = selectedIdList.includes(getCurrentDeviceIdentifier());
	busy = "selected-devices";
	try {
		await deleteDevicesApi(selectedIdList);
		devices = devices.filter((device) => !selectedIds[device.id]);
		selectedIds = {};
		onMessage("已移除选中设备");
		if (removesCurrent) await onSessionRevoked("device-removed");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}

async function confirmRemoveDevices() {
	if (!removeTarget) return;
	const target = removeTarget;
	removeTarget = null;
	if (target.kind === "single") await removeDevice(target.device);
	else await removeSelectedDevices();
}

function toggleAll(checked: boolean) {
	selectedIds = checked
		? Object.fromEntries(devices.map((device) => [device.id, true]))
		: {};
}

async function removeAllDevices() {
	if (!removeAllPassword) return;
	busy = "all-devices";
	try {
		await deleteAllDevicesApi(await passwordHash(removeAllPassword));
		devices = [];
		removeAllOpen = false;
		removeAllPassword = "";
		await onSessionRevoked("devices-removed");
	} catch (error) {
		onError(error);
	} finally {
		busy = "";
	}
}
</script>

<Card.Root>
	<Card.Header class="flex-col items-start justify-between gap-3 sm:flex-row">
		<div><Card.Title>设备</Card.Title><Card.Description>查看并撤销已登录设备。</Card.Description></div>
		<div class="flex flex-wrap gap-2">
			{#if selectedIdList.length}<Button variant="destructive" size="sm" onclick={() => removeTarget = { kind: "selected" }} disabled={busy === "selected-devices"}>移除已选（{selectedIdList.length}）</Button>{/if}
			<Button variant="destructive" size="sm" onclick={() => removeAllOpen = true} disabled={!devices.length || busy === "all-devices"}>移除全部</Button>
		</div>
	</Card.Header>
	<Card.Content class="overflow-x-auto">
		<Table.Root><Table.Header><Table.Row><Table.Head class="w-10"><Checkbox aria-label="选择全部设备" checked={devices.length > 0 && selectedIdList.length === devices.length} onCheckedChange={toggleAll} /></Table.Head><Table.Head>名称</Table.Head><Table.Head>最近登录</Table.Head><Table.Head>密钥状态</Table.Head><Table.Head class="text-right">操作</Table.Head></Table.Row></Table.Header><Table.Body>
			{#each devices as device (device.id)}<Table.Row><Table.Cell><Checkbox aria-label={`选择设备 ${device.name}`} checked={!!selectedIds[device.id]} onCheckedChange={(checked) => selectedIds = { ...selectedIds, [device.id]: checked }} /></Table.Cell><Table.Cell><div class="font-medium">{device.name}{device.id === getCurrentDeviceIdentifier() ? "（当前）" : ""}</div><div class="text-xs text-muted-foreground">{device.identifier}</div></Table.Cell><Table.Cell>{device.lastLoginDate ? new Date(device.lastLoginDate).toLocaleString() : "—"}</Table.Cell><Table.Cell><Badge variant="outline">{device.isTrusted ? "已保存设备密钥" : "未保存设备密钥"}</Badge></Table.Cell><Table.Cell><div class="flex justify-end gap-1"><Button variant="ghost" size="icon-sm" onclick={() => startRename(device)} aria-label="重命名设备"><Pencil data-icon /></Button><Button variant="ghost" size="icon-sm" onclick={() => removeTarget = { kind: "single", device }} disabled={busy === `device-${device.id}`} aria-label="移除设备"><Trash2 data-icon /></Button></div></Table.Cell></Table.Row>{:else}<Table.Row><Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">暂无设备记录</Table.Cell></Table.Row>{/each}
		</Table.Body></Table.Root>
	</Card.Content>
</Card.Root>

<Dialog.Root open={!!editingDevice} onOpenChange={(open) => { if (!open) editingDevice = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>重命名设备</Dialog.Title><Dialog.Description>名称用于区分登录设备。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="device-name">设备名称</Field.Label><Input id="device-name" bind:value={deviceName} /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => editingDevice = null}>取消</Button><Button onclick={saveDeviceName} disabled={!deviceName.trim()}>保存</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root bind:open={removeAllOpen}><Dialog.Content><Dialog.Header><Dialog.Title>移除全部设备</Dialog.Title><Dialog.Description>所有刷新令牌都会撤销，当前浏览器也会退出。请输入主密码确认。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="remove-devices-password">当前主密码</Field.Label><Input id="remove-devices-password" type="password" bind:value={removeAllPassword} autocomplete="current-password" /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => removeAllOpen = false}>取消</Button><Button variant="destructive" onclick={removeAllDevices} disabled={!removeAllPassword || busy === "all-devices"}>移除并退出</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<AlertDialog.Root open={removeTarget !== null} onOpenChange={(open) => { if (!open) removeTarget = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>移除设备</AlertDialog.Title><AlertDialog.Description>{removeTarget?.kind === "single" ? `移除设备“${removeTarget.device.name}”并撤销其会话？` : `移除选中的 ${selectedIdList.length} 台设备并撤销其会话？`}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action class="bg-destructive text-destructive-foreground hover:bg-destructive/90" onclick={confirmRemoveDevices}>确认移除</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
