<script lang="ts">
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
    <Card.Title>备份目的地</Card.Title>
    <Card.Action
      ><Button size="icon-sm" variant="ghost" onclick={onAdd} aria-label="添加新目的地"
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
            >未配置备份目的地</Empty.Title
          ><Empty.Description>添加 R2、WebDAV 或 S3 目的地以启用自动备份。</Empty.Description
          ></Empty.Header
        ><Empty.Content
          ><Button size="sm" onclick={onAdd}><Plus data-icon="inline-start" />添加目的地</Button
          ></Empty.Content
        ></Empty.Root
      >
    {/each}
  </Card.Content>
</Card.Root>
