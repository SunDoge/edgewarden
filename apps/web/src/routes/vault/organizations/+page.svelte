<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { onMount } from "svelte";
  import { canManageOrganizationMembers } from "@edgewarden/shared";
  import { Building2, Pencil, Plus } from "@lucide/svelte";
  import OrganizationCollectionsCard from "$lib/components/organizations/OrganizationCollectionsCard.svelte";
  import OrganizationDialogs from "$lib/components/organizations/OrganizationDialogs.svelte";
  import OrganizationMembersCard from "$lib/components/organizations/OrganizationMembersCard.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import { createOrganizationManager } from "$lib/services/organization-manager.svelte";

  const manager = createOrganizationManager();
  const state = manager.state;

  onMount(manager.load);
</script>

<svelte:head><title>{m.ui_organizations_edgewarden()}</title></svelte:head>

<VaultPageShell
  title={m.nav_organizations()}
  description={m.ui_organization_keys_are_decrypted_only_on_members_devices_the_server_cannot_read_s()}
>
  {#snippet actions()}
    <Button onclick={() => (state.createOpen = true)}
      ><Plus data-icon="inline-start" />{m.ui_create_organization()}</Button
    >
  {/snippet}
  {#if state.error}
    <Alert.Root variant="destructive">
      <Alert.Title>{m.ui_action_failed()}</Alert.Title>
      <Alert.Description>{state.error}</Alert.Description>
    </Alert.Root>
  {/if}
  {#if state.loading}
    <div class="flex items-center justify-center gap-2 py-12 text-muted-foreground">
      <Spinner />{m.ui_loading()}
    </div>
  {:else}
    <div class="grid gap-6 md:grid-cols-[16rem_1fr]">
      <Card.Root>
        <Card.Header><Card.Title>{m.ui_organization()}</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-2">
          {#each state.organizations as organization (organization.id)}
            <Button
              class="w-full justify-start"
              variant={state.selected?.id === organization.id ? "secondary" : "ghost"}
              onclick={() => manager.select(organization)}><Building2 />{organization.name}</Button
            >
          {:else}
            <p class="text-sm text-muted-foreground">
              {m.ui_you_have_not_created_or_joined_an_organization()}
            </p>
          {/each}
        </Card.Content>
      </Card.Root>
      {#if state.selected}
        <div class="flex min-w-0 flex-col gap-6">
          <Card.Root>
            <Card.Header>
              <div class="flex items-center justify-between">
                <div class="min-w-0">
                  <Card.Title class="truncate">{state.selected.name}</Card.Title>
                  <Card.Description
                    >{m.ui_role_value({ value0: state.selected.role })}</Card.Description
                  >
                </div>
                {#if state.selected.role === "owner"}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onclick={manager.openRenameOrganization}
                    aria-label={m.ui_rename_organization()}><Pencil data-icon /></Button
                  >
                {/if}
              </div>
            </Card.Header>
          </Card.Root>
          <OrganizationCollectionsCard
            organization={state.selected}
            collections={manager.collectionsFor(state.selected.id)}
            bind:name={state.collectionName}
            busy={state.busy === "collection"}
            onadd={manager.addCollection}
            onrename={manager.openRenameCollection}
            onremove={(collection) =>
              (state.removeTarget = {
                kind: "collection",
                id: collection.id,
                name: collection.name,
              })}
          />
          {#if canManageOrganizationMembers(state.selected.role)}
            <OrganizationMembersCard
              organization={state.selected}
              members={state.members}
              collections={manager.collectionsFor(state.selected.id)}
              bind:email={state.inviteEmail}
              bind:role={state.inviteRole}
              bind:accessAll={state.inviteAccessAll}
              bind:collectionIds={state.inviteCollectionIds}
              busy={state.busy === "invite"}
              oninvite={manager.inviteMember}
              onedit={manager.editMember}
              onremove={(member) =>
                (state.removeTarget = {
                  kind: "member",
                  id: member.id,
                  name: member.email,
                })}
            />
          {/if}
          {#if state.selected.role === "owner"}
            <Card.Root class="border-destructive/30">
              <Card.Header>
                <Card.Title>{m.ui_delete_organization()}</Card.Title>
                <Card.Description
                  >{m.ui_this_permanently_deletes_the_organization_s_collections_shared_items_and_members()}</Card.Description
                >
              </Card.Header>
              <Card.Content class="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="password"
                  bind:value={state.deletePassword}
                  autocomplete="current-password"
                  placeholder={m.ui_enter_your_master_password_to_confirm()}
                />
                <Button
                  variant="destructive"
                  onclick={manager.removeOrganization}
                  disabled={!state.deletePassword || state.busy === "delete-org"}
                  >{m.ui_delete_permanently()}</Button
                >
              </Card.Content>
            </Card.Root>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</VaultPageShell>

<OrganizationDialogs
  bind:createOpen={state.createOpen}
  bind:organizationName={state.organizationName}
  bind:initialCollectionName={state.initialCollectionName}
  busy={state.busy}
  bind:editingMember={state.editingMember}
  actorRole={state.selected?.role ?? null}
  bind:memberRole={state.memberRole}
  bind:memberAccessAll={state.memberAccessAll}
  bind:memberCollectionAccess={state.memberCollectionAccess}
  collections={state.selected ? manager.collectionsFor(state.selected.id) : []}
  bind:renameTarget={state.renameTarget}
  bind:renameName={state.renameName}
  bind:removeTarget={state.removeTarget}
  oncreate={manager.create}
  onSaveMember={manager.saveMember}
  onSaveRename={manager.saveRename}
  onConfirmRemove={manager.confirmRemove}
/>
