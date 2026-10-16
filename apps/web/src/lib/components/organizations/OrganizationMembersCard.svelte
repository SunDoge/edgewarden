<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Pencil, Trash2, UserPlus } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import type {
    OrganizationCollection,
    OrganizationMember,
    OrganizationSummary,
  } from "$lib/services/organization-types";

  let {
    organization,
    members,
    collections,
    email = $bindable(""),
    role = $bindable<"admin" | "manager" | "member">("member"),
    accessAll = $bindable(true),
    collectionIds = $bindable<string[]>([]),
    busy,
    oninvite,
    onedit,
    onremove,
  }: {
    organization: Pick<OrganizationSummary, "role">;
    members: OrganizationMember[];
    collections: Array<Pick<OrganizationCollection, "id" | "name">>;
    email: string;
    role: "admin" | "manager" | "member";
    accessAll: boolean;
    collectionIds: string[];
    busy: boolean;
    oninvite: () => void;
    onedit: (member: OrganizationMember) => void;
    onremove: (member: OrganizationMember) => void;
  } = $props();

  function toggleCollection(id: string, checked: boolean) {
    collectionIds = checked
      ? [...new Set([...collectionIds, id])]
      : collectionIds.filter((value) => value !== id);
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.ui_members()}</Card.Title>
    <Card.Description
      >{m.ui_basic_roles_and_collection_access_are_supported_advanced_organization_policies_a()}</Card.Description
    >
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    <div class="grid gap-3 md:grid-cols-[1fr_10rem_auto]">
      <Input
        type="email"
        bind:value={email}
        placeholder={m.ui_registered_user_s_email()}
        aria-label={m.ui_member_email()}
      />
      <Select.Root type="single" bind:value={role}>
        <Select.Trigger aria-label={m.ui_member_role()}>{role}</Select.Trigger>
        <Select.Content
          ><Select.Group
            ><Select.Item value="member">member</Select.Item
            >{#if organization.role !== "manager"}<Select.Item value="manager">manager</Select.Item
              >{/if}{#if organization.role === "owner"}<Select.Item value="admin">admin</Select.Item
              >{/if}</Select.Group
          ></Select.Content
        >
      </Select.Root>
      <Button onclick={oninvite} disabled={!email.trim() || busy}
        ><UserPlus data-icon="inline-start" />{m.ui_add()}</Button
      >
    </div>
    <Field.Field orientation="horizontal"
      ><Checkbox id="invite-access-all" bind:checked={accessAll} /><Field.Label
        for="invite-access-all">{m.ui_access_all_collections()}</Field.Label
      ></Field.Field
    >
    {#if !accessAll}
      <Field.FieldSet
        ><Field.FieldLegend>{m.ui_allowed_collections()}</Field.FieldLegend><Field.FieldGroup
          class="grid sm:grid-cols-2"
          >{#each collections as collection}<Field.Field orientation="horizontal"
              ><Checkbox
                id={`invite-${collection.id}`}
                checked={collectionIds.includes(collection.id)}
                onCheckedChange={(checked) => toggleCollection(collection.id, checked)}
              /><Field.Label for={`invite-${collection.id}`}>{collection.name}</Field.Label
              ></Field.Field
            >{/each}</Field.FieldGroup
        ></Field.FieldSet
      >
    {/if}

    <!-- Cards avoid forcing a four-column table into a phone viewport. -->
    <div class="grid gap-2 md:hidden">
      {#each members as member (member.id)}
        <div class="rounded-lg border p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-medium">{member.email}</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {member.role} · {member.accessAll
                  ? m.ui_all_collections()
                  : m.ui_collections_value({ value0: member.collections?.length ?? 0 })}
              </p>
            </div>
            {#if member.role !== "owner"}<div class="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onclick={() => onedit(member)}
                  aria-label={m.ui_edit_member_value({ value0: member.email })}
                  ><Pencil data-icon /></Button
                ><Button
                  variant="ghost"
                  size="icon-sm"
                  onclick={() => onremove(member)}
                  aria-label={m.ui_remove_member_value({ value0: member.email })}
                  ><Trash2 data-icon /></Button
                >
              </div>{/if}
          </div>
        </div>
      {:else}<p class="py-4 text-center text-sm text-muted-foreground">
          {m.ui_no_other_members_yet()}
        </p>{/each}
    </div>
    <div class="hidden md:block">
      <Table.Root
        ><Table.Header
          ><Table.Row
            ><Table.Head>{m.ui_email_2()}</Table.Head><Table.Head>{m.ui_role()}</Table.Head
            ><Table.Head>{m.ui_scope()}</Table.Head><Table.Head class="text-right"
              >{m.ui_actions()}</Table.Head
            ></Table.Row
          ></Table.Header
        ><Table.Body
          >{#each members as member (member.id)}<Table.Row
              ><Table.Cell>{member.email}</Table.Cell><Table.Cell>{member.role}</Table.Cell
              ><Table.Cell
                >{member.accessAll
                  ? m.ui_all()
                  : m.ui_collections_value({ value0: member.collections?.length ?? 0 })}</Table.Cell
              ><Table.Cell class="text-right"
                >{#if member.role !== "owner"}<Button
                    variant="ghost"
                    size="icon-sm"
                    onclick={() => onedit(member)}
                    aria-label={m.ui_edit_member_value({ value0: member.email })}
                    ><Pencil data-icon /></Button
                  ><Button
                    variant="ghost"
                    size="icon-sm"
                    onclick={() => onremove(member)}
                    aria-label={m.ui_remove_member_value({ value0: member.email })}
                    ><Trash2 data-icon /></Button
                  >{/if}</Table.Cell
              ></Table.Row
            >{/each}</Table.Body
        ></Table.Root
      >
    </div>
  </Card.Content>
</Card.Root>
