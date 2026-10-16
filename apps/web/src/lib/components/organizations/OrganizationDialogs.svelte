<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

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
      ><Dialog.Title>{m.ui_create_organization()}</Dialog.Title><Dialog.Description
        >{m.ui_your_browser_will_generate_an_organization_key_and_an_rsa_key_pair()}</Dialog.Description
      ></Dialog.Header
    >
    <Field.Group>
      <Field.Field
        ><Field.Label for="organization-name">{m.ui_organization_name()}</Field.Label><Input
          id="organization-name"
          bind:value={organizationName}
        /></Field.Field
      >
      <Field.Field
        ><Field.Label for="collection-name">{m.ui_initial_collection()}</Field.Label><Input
          id="collection-name"
          bind:value={initialCollectionName}
        /></Field.Field
      >
    </Field.Group>
    <Dialog.Footer
      ><Button variant="outline" onclick={() => (createOpen = false)}>{m.login_cancel()}</Button
      ><Button
        onclick={oncreate}
        disabled={!organizationName.trim() || !initialCollectionName.trim() || busy === "create"}
        >{m.ui_create()}</Button
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
      ><Dialog.Title>{m.ui_member_permissions()}</Dialog.Title><Dialog.Description
        >{editingMember?.email}</Dialog.Description
      ></Dialog.Header
    >
    <Field.Group>
      <Field.Field
        ><Field.Label>{m.ui_role()}</Field.Label><Select.Root type="single" bind:value={memberRole}
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
          for="member-access-all">{m.ui_access_all_collections()}</Field.Label
        ></Field.Field
      >
      {#if !memberAccessAll}<Field.FieldSet
          ><Field.FieldLegend>{m.ui_collection_permissions()}</Field.FieldLegend><Field.FieldGroup>
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
                      /><Field.Label for={`readonly-${collection.id}`}
                        >{m.ui_read_only()}</Field.Label
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
                      /><Field.Label for={`hide-${collection.id}`}
                        >{m.login_hide_password()}</Field.Label
                      ></Field.Field
                    ></Field.FieldGroup
                  >{/if}</Field.FieldSet
              >
            {/each}
          </Field.FieldGroup></Field.FieldSet
        >{/if}
    </Field.Group>
    <Dialog.Footer
      ><Button variant="outline" onclick={() => (editingMember = null)}>{m.login_cancel()}</Button
      ><Button onclick={onSaveMember} disabled={busy === "member"}>{m.ui_save()}</Button
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
        >{renameTarget?.kind === "organization"
          ? m.ui_rename_organization()
          : m.ui_rename_collection()}</Dialog.Title
      ><Dialog.Description>{m.ui_enter_a_new_name_that_members_will_recognize()}</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="rename-name">{m.ui_name()}</Field.Label><Input
        id="rename-name"
        bind:value={renameName}
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (renameTarget = null)}>{m.login_cancel()}</Button
      ><Button onclick={onSaveRename} disabled={!renameName.trim()}>{m.ui_save()}</Button
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
        >{removeTarget?.kind === "member"
          ? m.ui_remove_organization_member()
          : m.ui_delete_collection()}</AlertDialog.Title
      ><AlertDialog.Description
        >{removeTarget?.kind === "member"
          ? m.ui_remove_member_value_2({ value0: removeTarget.name })
          : m.ui_delete_collection_value_move_or_delete_its_items_first({
              value0: removeTarget?.name ?? "",
            })}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m.login_cancel()}</AlertDialog.Cancel><AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={onConfirmRemove}>{m.ui_confirm()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>
