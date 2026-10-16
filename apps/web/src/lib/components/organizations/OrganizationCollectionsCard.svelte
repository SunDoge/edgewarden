<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { canManageOrganizationCollections } from "@edgewarden/shared";
  import { Pencil, Trash2 } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import type {
    OrganizationCollection,
    OrganizationSummary,
  } from "$lib/services/organization-types";

  let {
    organization,
    collections,
    name = $bindable(""),
    busy,
    onadd,
    onrename,
    onremove,
  }: {
    organization: Pick<OrganizationSummary, "role" | "accessAll">;
    collections: Array<Pick<OrganizationCollection, "id" | "name">>;
    name: string;
    busy: boolean;
    onadd: () => void;
    onrename: (collection: Pick<OrganizationCollection, "id" | "name">) => void;
    onremove: (collection: Pick<OrganizationCollection, "id" | "name">) => void;
  } = $props();

  const canManage = $derived(canManageOrganizationCollections(organization));
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.ui_collections()}</Card.Title>
    <Card.Description
      >{m.ui_collections_organize_shared_items_and_control_member_access()}</Card.Description
    >
  </Card.Header>
  <Card.Content>
    {#if canManage}
      <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input
          bind:value={name}
          placeholder={m.ui_new_collection_name()}
          aria-label={m.ui_new_collection_name()}
        />
        <Button onclick={onadd} disabled={!name.trim() || busy}>{m.ui_add_collection()}</Button>
      </div>
    {/if}
    <div class:mt-4={canManage} class="flex flex-col gap-2">
      {#each collections as collection (collection.id)}
        <div class="flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <span class="min-w-0 truncate">{collection.name}</span>
          {#if canManage}
            <div class="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onclick={() => onrename(collection)}
                aria-label={m.ui_rename_collection_value({ value0: collection.name })}
                ><Pencil data-icon /></Button
              >
              <Button
                variant="ghost"
                size="icon-sm"
                onclick={() => onremove(collection)}
                aria-label={m.ui_delete_collection_value({ value0: collection.name })}
                ><Trash2 data-icon /></Button
              >
            </div>
          {/if}
        </div>
      {:else}
        <p class="py-4 text-center text-sm text-muted-foreground">{m.ui_no_collections_yet()}</p>
      {/each}
    </div>
  </Card.Content>
</Card.Root>
