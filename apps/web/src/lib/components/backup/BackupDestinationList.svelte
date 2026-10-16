<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Plus } from "@lucide/svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import type { BackupDestinationRecord } from "./types";

  let {
    destinations,
    selectedId,
    onAdd,
    onSelect,
  }: {
    destinations: BackupDestinationRecord[];
    selectedId: string | null;
    onAdd: () => void;
    onSelect: (id: string) => void;
  } = $props();
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.ui_backup_destinations()}</Card.Title>
    <Card.Action
      ><Button size="icon-sm" variant="ghost" onclick={onAdd} aria-label={m.ui_add_destination()}
        ><Plus /></Button
      ></Card.Action
    >
  </Card.Header>
  <Card.Content class="flex flex-col gap-1.5">
    {#each destinations as destination (destination.id)}
      <Button
        variant={selectedId === destination.id ? "secondary" : "ghost"}
        class="w-full justify-between"
        onclick={() => onSelect(destination.id)}
      >
        <span class="truncate pr-2">{destination.name}</span>
        <Badge variant="outline" class="uppercase">{destination.type}</Badge>
      </Button>
    {:else}
      <Empty.Root
        ><Empty.Header
          ><Empty.Media variant="icon"><Plus /></Empty.Media><Empty.Title
            >{m.ui_no_backup_destinations_configured()}</Empty.Title
          ><Empty.Description
            >{m.ui_add_an_r2_webdav_or_s3_destination_to_enable_automatic_backups()}</Empty.Description
          ></Empty.Header
        ><Empty.Content
          ><Button size="sm" onclick={onAdd}
            ><Plus data-icon="inline-start" />{m.ui_add_destination_2()}</Button
          ></Empty.Content
        ></Empty.Root
      >
    {/each}
  </Card.Content>
</Card.Root>
