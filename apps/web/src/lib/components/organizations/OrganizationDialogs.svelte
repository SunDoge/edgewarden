<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import type {
    MemberCollectionAccessEditor,
    OrganizationCollection,
    OrganizationMember,
    OrganizationRemoveTarget,
    OrganizationRenameTarget,
    OrganizationRole,
  } from "$lib/services/organization-types";

  let {
    createOpen = $bindable(),
    organizationName = $bindable(),
    initialCollectionName = $bindable(),
    busy,
    editingMember = $bindable(),
    actorRole,
    memberRole = $bindable(),
    memberAccessAll = $bindable(),
    memberCollectionAccess = $bindable(),
    collections,
    renameTarget = $bindable(),
    renameName = $bindable(),
    removeTarget = $bindable(),
    oncreate,
    onSaveMember,
    onSaveRename,
    onConfirmRemove,
  }: {
    createOpen: boolean;
    organizationName: string;
    initialCollectionName: string;
    busy: string;
    editingMember: OrganizationMember | null;
    actorRole: OrganizationRole | null;
    memberRole: Exclude<OrganizationRole, "owner">;
    memberAccessAll: boolean;
    memberCollectionAccess: Record<string, MemberCollectionAccessEditor>;
    collections: OrganizationCollection[];
    renameTarget: OrganizationRenameTarget | null;
    renameName: string;
    removeTarget: OrganizationRemoveTarget | null;
    oncreate: () => void;
    onSaveMember: () => void;
    onSaveRename: () => void;
    onConfirmRemove: () => void;
  } = $props();
</script>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content>
    <Dialog.Header
      ><Dialog.Title>创建组织</Dialog.Title><Dialog.Description
        >浏览器会生成独立组织密钥和 RSA 密钥对。</Dialog.Description
      ></Dialog.Header
    >
    <Field.Group>
      <Field.Field
        ><Field.Label for="organization-name">组织名称</Field.Label><Input
          id="organization-name"
          bind:value={organizationName}
        /></Field.Field
      >
      <Field.Field
        ><Field.Label for="collection-name">初始集合</Field.Label><Input
          id="collection-name"
          bind:value={initialCollectionName}
        /></Field.Field
      >
    </Field.Group>
    <Dialog.Footer
      ><Button variant="outline" onclick={() => (createOpen = false)}>取消</Button><Button
        onclick={oncreate}
        disabled={!organizationName.trim() || !initialCollectionName.trim() || busy === "create"}
        >创建</Button
      ></Dialog.Footer
    >
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root
  open={Boolean(editingMember)}
  onOpenChange={(open) => {
    if (!open) editingMember = null;
  }}
>
  <Dialog.Content>
    <Dialog.Header
      ><Dialog.Title>成员权限</Dialog.Title><Dialog.Description
        >{editingMember?.email}</Dialog.Description
      ></Dialog.Header
    >
    <Field.Group>
      <Field.Field
        ><Field.Label>角色</Field.Label><Select.Root type="single" bind:value={memberRole}
          ><Select.Trigger>{memberRole}</Select.Trigger><Select.Content
            ><Select.Group
              ><Select.Item value="member">member</Select.Item
              >{#if actorRole !== "manager"}<Select.Item value="manager">manager</Select.Item
                >{/if}{#if actorRole === "owner"}<Select.Item value="admin">admin</Select.Item
                >{/if}</Select.Group
            ></Select.Content
          ></Select.Root
        ></Field.Field
      >
      <Field.Field orientation="horizontal"
        ><Checkbox id="member-access-all" bind:checked={memberAccessAll} /><Field.Label
          for="member-access-all">访问全部集合</Field.Label
        ></Field.Field
      >
      {#if !memberAccessAll}<Field.FieldSet
          ><Field.FieldLegend>集合权限</Field.FieldLegend><Field.FieldGroup>
            {#each collections as collection}{@const access = memberCollectionAccess[collection.id]}
              <Field.FieldSet class="rounded-md border p-3"
                ><Field.Field orientation="horizontal"
                  ><Checkbox
                    id={`member-${collection.id}`}
                    checked={access?.selected}
                    onCheckedChange={(checked) =>
                      (memberCollectionAccess = {
                        ...memberCollectionAccess,
                        [collection.id]: {
                          ...(access ?? { readOnly: false, hidePasswords: false }),
                          selected: checked,
                        },
                      })}
                  /><Field.Label for={`member-${collection.id}`}>{collection.name}</Field.Label
                  ></Field.Field
                >
                {#if access?.selected}<Field.FieldGroup class="mt-2 pl-6"
                    ><Field.Field orientation="horizontal"
                      ><Checkbox
                        id={`readonly-${collection.id}`}
                        checked={access.readOnly}
                        onCheckedChange={(checked) =>
                          (memberCollectionAccess = {
                            ...memberCollectionAccess,
                            [collection.id]: { ...access, readOnly: checked },
                          })}
                      /><Field.Label for={`readonly-${collection.id}`}>只读</Field.Label
                      ></Field.Field
                    ><Field.Field orientation="horizontal"
                      ><Checkbox
                        id={`hide-${collection.id}`}
                        checked={access.hidePasswords}
                        onCheckedChange={(checked) =>
                          (memberCollectionAccess = {
                            ...memberCollectionAccess,
                            [collection.id]: { ...access, hidePasswords: checked },
                          })}
                      /><Field.Label for={`hide-${collection.id}`}>隐藏密码</Field.Label
                      ></Field.Field
                    ></Field.FieldGroup
                  >{/if}</Field.FieldSet
              >
            {/each}
          </Field.FieldGroup></Field.FieldSet
        >{/if}
    </Field.Group>
    <Dialog.Footer
      ><Button variant="outline" onclick={() => (editingMember = null)}>取消</Button><Button
        onclick={onSaveMember}
        disabled={busy === "member"}>保存</Button
      ></Dialog.Footer
    >
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root
  open={renameTarget !== null}
  onOpenChange={(open) => {
    if (!open) renameTarget = null;
  }}
>
  <Dialog.Content
    ><Dialog.Header
      ><Dialog.Title
        >{renameTarget?.kind === "organization" ? "重命名组织" : "重命名集合"}</Dialog.Title
      ><Dialog.Description>输入一个便于成员识别的新名称。</Dialog.Description></Dialog.Header
    ><Field.Field
      ><Field.Label for="rename-name">名称</Field.Label><Input
        id="rename-name"
        bind:value={renameName}
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (renameTarget = null)}>取消</Button><Button
        onclick={onSaveRename}
        disabled={!renameName.trim()}>保存</Button
      ></Dialog.Footer
    ></Dialog.Content
  >
</Dialog.Root>

<AlertDialog.Root
  open={removeTarget !== null}
  onOpenChange={(open) => {
    if (!open) removeTarget = null;
  }}
>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title
        >{removeTarget?.kind === "member" ? "移除组织成员" : "删除集合"}</AlertDialog.Title
      ><AlertDialog.Description
        >{removeTarget?.kind === "member"
          ? `确定要移除成员 ${removeTarget.name}？`
          : `确定要删除集合 ${removeTarget?.name}？集合内条目必须先移动或删除。`}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={onConfirmRemove}>确认</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>
