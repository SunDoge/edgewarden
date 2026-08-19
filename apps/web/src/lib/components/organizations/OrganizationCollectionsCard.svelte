<script lang="ts">
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
  organization: Pick<OrganizationSummary, "role">;
  collections: Array<Pick<OrganizationCollection, "id" | "name">>;
  name: string;
  busy: boolean;
  onadd: () => void;
  onrename: (collection: Pick<OrganizationCollection, "id" | "name">) => void;
  onremove: (collection: Pick<OrganizationCollection, "id" | "name">) => void;
} = $props();

const canManage = $derived(
  ["owner", "admin", "manager"].includes(organization.role),
);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>集合</Card.Title>
		<Card.Description>集合用于划分共享条目及成员的访问范围。</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if canManage}
			<div class="grid gap-3 sm:grid-cols-[1fr_auto]">
				<Input bind:value={name} placeholder="新集合名称" aria-label="新集合名称" />
				<Button onclick={onadd} disabled={!name.trim() || busy}>添加集合</Button>
			</div>
		{/if}
		<div class:mt-4={canManage} class="flex flex-col gap-2">
			{#each collections as collection (collection.id)}
				<div class="flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2">
					<span class="min-w-0 truncate">{collection.name}</span>
					{#if canManage}
						<div class="flex shrink-0 gap-1">
							<Button variant="ghost" size="icon-sm" onclick={() => onrename(collection)} aria-label={`重命名集合 ${collection.name}`}><Pencil data-icon /></Button>
							<Button variant="ghost" size="icon-sm" onclick={() => onremove(collection)} aria-label={`删除集合 ${collection.name}`}><Trash2 data-icon /></Button>
						</div>
					{/if}
				</div>
			{:else}
				<p class="py-4 text-center text-sm text-muted-foreground">还没有集合。</p>
			{/each}
		</div>
	</Card.Content>
</Card.Root>
