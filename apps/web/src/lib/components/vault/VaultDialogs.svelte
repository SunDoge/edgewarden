<script lang="ts">
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
      ><AlertDialog.Title>确认删除</AlertDialog.Title><AlertDialog.Description
        >{selectedItemDeleted
          ? `确定要永久删除“${selectedItemName}”吗？此操作无法撤销。`
          : `确定要将“${selectedItemName}”移到回收站吗？`}</AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel disabled={deleteLoading}>取消</AlertDialog.Cancel><AlertDialog.Action
        onclick={onDeleteItem}
        disabled={deleteLoading}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >{selectedItemDeleted ? "永久删除" : "移到回收站"}</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteAllFoldersOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title>删除全部文件夹</AlertDialog.Title><AlertDialog.Description
        >将删除全部 {folders.length} 个文件夹。保险库项目不会被删除，而会移至“无文件夹”。此操作不可撤销。</AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel disabled={folderLoading}>取消</AlertDialog.Cancel><AlertDialog.Action
        onclick={onDeleteAllFolders}
        disabled={folderLoading}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >确认删除全部</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={moveOpen}>
  <Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>移动所选条目</Dialog.Title><Dialog.Description
        >选择目标文件夹；选择“无文件夹”会移出当前文件夹。</Dialog.Description
      ></Dialog.Header
    ><Select.Root
      type="single"
      value={moveFolderId ?? "__none"}
      onValueChange={(value) => (moveFolderId = value === "__none" ? null : value)}
      ><Select.Trigger class="w-full"
        >{moveFolderId
          ? (folders.find((folder) => folder.id === moveFolderId)?.name ?? "选择文件夹")
          : "无文件夹"}</Select.Trigger
      ><Select.Content
        ><Select.Group
          ><Select.Item value="__none">无文件夹</Select.Item
          >{#each folders as folder (folder.id)}<Select.Item value={folder.id}
              >{folder.name}</Select.Item
            >{/each}</Select.Group
        ></Select.Content
      ></Select.Root
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (moveOpen = false)}>取消</Button><Button
        onclick={onMoveItems}
        disabled={deleteLoading}>移动 {selectedCount} 项</Button
      ></Dialog.Footer
    ></Dialog.Content
  >
</Dialog.Root>

<AlertDialog.Root bind:open={folderOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title
        >{folderMode === "create" ? "新建文件夹" : "重命名文件夹"}</AlertDialog.Title
      ><AlertDialog.Description>请输入文件夹的名称：</AlertDialog.Description></AlertDialog.Header
    >
    <div class="py-4">
      <Input
        placeholder="文件夹名称"
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
      ><AlertDialog.Cancel disabled={folderLoading}>取消</AlertDialog.Cancel><AlertDialog.Action
        onclick={onSaveFolder}
        disabled={folderLoading || !folderName.trim()}>保存</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteFolderOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title>确认删除文件夹</AlertDialog.Title><AlertDialog.Description
        >确定要删除文件夹「{targetFolderName}」吗？<span class="mt-2 block text-xs text-destructive"
          >此操作仅删除文件夹本身，文件夹内的密码项将移至未分类。</span
        ></AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel disabled={folderLoading}>取消</AlertDialog.Cancel><AlertDialog.Action
        onclick={onDeleteFolder}
        disabled={folderLoading}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >确认删除</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>
