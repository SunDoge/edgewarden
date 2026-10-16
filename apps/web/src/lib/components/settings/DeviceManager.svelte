<script lang="ts">
  import { formatDateTime } from "$lib/i18n/format";
  import * as m from "$lib/paraglide/messages.js";

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
    onSessionRevoked: (reason: "device-removed" | "devices-removed") => Promise<void>;
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
      onMessage(m.ui_device_name_updated());
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
      onMessage(m.ui_selected_devices_removed());
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
    selectedIds = checked ? Object.fromEntries(devices.map((device) => [device.id, true])) : {};
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
    <div>
      <Card.Title>{m.ui_devices()}</Card.Title><Card.Description
        >{m.ui_view_and_revoke_logged_in_devices()}</Card.Description
      >
    </div>
    <div class="flex flex-wrap gap-2">
      {#if selectedIdList.length}<Button
          variant="destructive"
          size="sm"
          onclick={() => (removeTarget = { kind: "selected" })}
          disabled={busy === "selected-devices"}
          >{m.ui_remove_selected_value({ value0: selectedIdList.length })}</Button
        >{/if}
      <Button
        variant="destructive"
        size="sm"
        onclick={() => (removeAllOpen = true)}
        disabled={!devices.length || busy === "all-devices"}>{m.ui_remove_all()}</Button
      >
    </div>
  </Card.Header>
  <Card.Content class="overflow-x-auto">
    <Table.Root
      ><Table.Header
        ><Table.Row
          ><Table.Head class="w-10"
            ><Checkbox
              aria-label={m.ui_select_all_devices()}
              checked={devices.length > 0 && selectedIdList.length === devices.length}
              onCheckedChange={toggleAll}
            /></Table.Head
          ><Table.Head>{m.ui_name()}</Table.Head><Table.Head>{m.ui_last_active()}</Table.Head
          ><Table.Head>{m.ui_key_status()}</Table.Head><Table.Head class="text-right"
            >{m.ui_actions()}</Table.Head
          ></Table.Row
        ></Table.Header
      ><Table.Body>
        {#each devices as device (device.id)}<Table.Row
            ><Table.Cell
              ><Checkbox
                aria-label={m.ui_select_device_value({ value0: device.name })}
                checked={!!selectedIds[device.id]}
                onCheckedChange={(checked) =>
                  (selectedIds = { ...selectedIds, [device.id]: checked })}
              /></Table.Cell
            ><Table.Cell
              ><div class="font-medium">
                {device.name}{device.id === getCurrentDeviceIdentifier() ? m.ui_current() : ""}
              </div>
              <div class="text-xs text-muted-foreground">{device.identifier}</div></Table.Cell
            ><Table.Cell
              >{device.lastActivityDate ? formatDateTime(device.lastActivityDate) : "—"}</Table.Cell
            ><Table.Cell
              ><Badge variant="outline"
                >{device.isTrusted ? m.ui_device_key_saved() : m.ui_no_device_key_saved()}</Badge
              ></Table.Cell
            ><Table.Cell
              ><div class="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onclick={() => startRename(device)}
                  aria-label={m.ui_rename_device()}><Pencil data-icon /></Button
                ><Button
                  variant="ghost"
                  size="icon-sm"
                  onclick={() => (removeTarget = { kind: "single", device })}
                  disabled={busy === `device-${device.id}`}
                  aria-label={m.ui_remove_device()}><Trash2 data-icon /></Button
                >
              </div></Table.Cell
            ></Table.Row
          >{:else}<Table.Row
            ><Table.Cell colspan={5} class="py-8 text-center text-muted-foreground"
              >{m.ui_no_device_records()}</Table.Cell
            ></Table.Row
          >{/each}
      </Table.Body></Table.Root
    >
  </Card.Content>
</Card.Root>

<Dialog.Root
  open={!!editingDevice}
  onOpenChange={(open) => {
    if (!open) editingDevice = null;
  }}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_rename_device()}</Dialog.Title><Dialog.Description
        >{m.ui_choose_a_name_to_recognize_this_device()}</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="device-name">{m.ui_device_name()}</Field.Label><Input
        id="device-name"
        bind:value={deviceName}
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (editingDevice = null)}>{m.login_cancel()}</Button
      ><Button onclick={saveDeviceName} disabled={!deviceName.trim()}>{m.ui_save()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root bind:open={removeAllOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_remove_all_devices()}</Dialog.Title><Dialog.Description
        >{m.ui_all_refresh_tokens_will_be_revoked_and_this_browser_will_log_out_too_enter_your_()}</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="remove-devices-password">{m.ui_current_master_password()}</Field.Label
      ><Input
        id="remove-devices-password"
        type="password"
        bind:value={removeAllPassword}
        autocomplete="current-password"
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (removeAllOpen = false)}>{m.login_cancel()}</Button
      ><Button
        variant="destructive"
        onclick={removeAllDevices}
        disabled={!removeAllPassword || busy === "all-devices"}>{m.ui_remove_and_log_out()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<AlertDialog.Root
  open={removeTarget !== null}
  onOpenChange={(open) => {
    if (!open) removeTarget = null;
  }}
  ><AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>{m.ui_remove_device()}</AlertDialog.Title><AlertDialog.Description
        >{removeTarget?.kind === "single"
          ? m.ui_remove_device_value_and_revoke_its_sessions({ value0: removeTarget.device.name })
          : m.ui_remove_value_selected_devices_and_revoke_their_sessions({
              value0: selectedIdList.length,
            })}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={confirmRemoveDevices}>{m.ui_confirm_removal()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  ></AlertDialog.Root
>
