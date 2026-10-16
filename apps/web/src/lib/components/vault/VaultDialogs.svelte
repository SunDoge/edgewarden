<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";

  interface FolderOption {
    id: string;
    name: string;
  }

  let {
    deleteOpen = $bindable(),
    deleteAllFoldersOpen = $bindable(),
    moveOpen = $bindable(),
    folderOpen = $bindable(),
    deleteFolderOpen = $bindable(),
    moveFolderId = $bindable(),
    folderName = $bindable(),
    selectedItemName,
    selectedItemDeleted,
    deleteLoading,
    folders,
    selectedCount,
    folderMode,
    folderLoading,
    targetFolderName,
    onDeleteItem,
    onDeleteAllFolders,
    onMoveItems,
    onSaveFolder,
    onDeleteFolder,
  }: {
    deleteOpen: boolean;
    deleteAllFoldersOpen: boolean;
    moveOpen: boolean;
    folderOpen: boolean;
    deleteFolderOpen: boolean;
    moveFolderId: string | null;
    folderName: string;
    selectedItemName?: string;
    selectedItemDeleted: boolean;
    deleteLoading: boolean;
    folders: FolderOption[];
    selectedCount: number;
    folderMode: "create" | "rename";
    folderLoading: boolean;
    targetFolderName?: string;
    onDeleteItem: () => void;
    onDeleteAllFolders: () => void;
    onMoveItems: () => void;
    onSaveFolder: () => void;
    onDeleteFolder: () => void;
  } = $props();
</script>

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title>{m.ui_confirm_deletion()}</AlertDialog.Title><AlertDialog.Description
        >{selectedItemDeleted
          ? m.ui_permanently_delete_value_this_cannot_be_undone({ value0: selectedItemName ?? "" })
          : m.ui_move_value_to_the_trash({
              value0: selectedItemName ?? "",
            })}</AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel disabled={deleteLoading}>{m.login_cancel()}</AlertDialog.Cancel
      ><AlertDialog.Action
        onclick={onDeleteItem}
        disabled={deleteLoading}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >{selectedItemDeleted
          ? m.ui_delete_permanently()
          : m.ui_move_to_trash()}</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteAllFoldersOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title>{m.ui_delete_all_folders()}</AlertDialog.Title><AlertDialog.Description
        >{m.ui_delete_all_value_folders_vault_items_will_not_be_deleted_they_will_move_to_no_fo({
          value0: folders.length,
        })}</AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel disabled={folderLoading}>{m.login_cancel()}</AlertDialog.Cancel
      ><AlertDialog.Action
        onclick={onDeleteAllFolders}
        disabled={folderLoading}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >{m.ui_delete_all()}</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={moveOpen}>
  <Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>{m.ui_move_selected_items()}</Dialog.Title><Dialog.Description
        >{m.ui_choose_a_destination_select_no_folder_to_remove_items_from_their_current_folder()}</Dialog.Description
      ></Dialog.Header
    ><Select.Root
      type="single"
      value={moveFolderId ?? "__none"}
      onValueChange={(value) => (moveFolderId = value === "__none" ? null : value)}
      ><Select.Trigger class="w-full"
        >{moveFolderId
          ? (folders.find((folder) => folder.id === moveFolderId)?.name ?? m.ui_select_folder())
          : m.ui_no_folder()}</Select.Trigger
      ><Select.Content
        ><Select.Group
          ><Select.Item value="__none">{m.ui_no_folder()}</Select.Item
          >{#each folders as folder (folder.id)}<Select.Item value={folder.id}
              >{folder.name}</Select.Item
            >{/each}</Select.Group
        ></Select.Content
      ></Select.Root
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (moveOpen = false)}>{m.login_cancel()}</Button
      ><Button onclick={onMoveItems} disabled={deleteLoading}
        >{m.ui_move_value_items({ value0: selectedCount })}</Button
      ></Dialog.Footer
    ></Dialog.Content
  >
</Dialog.Root>

<AlertDialog.Root bind:open={folderOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title
        >{folderMode === "create" ? m.ui_new_folder() : m.ui_rename_folder()}</AlertDialog.Title
      ><AlertDialog.Description>{m.ui_enter_a_folder_name()}</AlertDialog.Description
      ></AlertDialog.Header
    >
    <div class="py-4">
      <Input
        placeholder={m.ui_folder_name()}
        bind:value={folderName}
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSaveFolder();
          }
        }}
        autofocus
      />
    </div>
    <AlertDialog.Footer
      ><AlertDialog.Cancel disabled={folderLoading}>{m.login_cancel()}</AlertDialog.Cancel
      ><AlertDialog.Action onclick={onSaveFolder} disabled={folderLoading || !folderName.trim()}
        >{m.ui_save()}</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteFolderOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title>{m.ui_delete_folder()}</AlertDialog.Title><AlertDialog.Description
        >{m.ui_delete_folder_value({ value0: targetFolderName ?? "" })}<span
          class="mt-2 block text-xs text-destructive"
          >{m.ui_only_the_folder_will_be_deleted_its_items_will_move_to_no_folder()}</span
        ></AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel disabled={folderLoading}>{m.login_cancel()}</AlertDialog.Cancel
      ><AlertDialog.Action
        onclick={onDeleteFolder}
        disabled={folderLoading}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >{m.ui_confirm_deletion()}</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>
