<script lang="ts">
  import type { GlobalEquivalentDomain } from "@edgewarden/shared";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Search } from "@lucide/svelte";
  import { cn } from "$lib/utils";

  let {
    rules,
    excludedTypes = $bindable(),
  }: {
    rules: GlobalEquivalentDomain[];
    excludedTypes: Set<number>;
  } = $props();

  let searchQuery = $state("");
  let filteredRules = $derived(
    rules.filter((rule) => {
      const query = searchQuery.toLowerCase().trim();
      return !query || rule.domains.some((domain) => domain.includes(query));
    }),
  );

  function toggle(type: number) {
    const next = new Set(excludedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    excludedTypes = next;
  }
</script>

<Card.Root class="min-h-[500px] min-w-0">
  <Card.Header>
    <Card.Title>全局等效规则</Card.Title>
    <Card.Description>Bitwarden 标准全局等效域名表</Card.Description>
    <Card.Action
      ><div class="relative w-full md:w-48">
        <Search
          class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        /><Input
          type="search"
          placeholder="搜索全局域名..."
          bind:value={searchQuery}
          class="pl-8 text-xs"
          aria-label="搜索全局等效域名"
        />
      </div></Card.Action
    >
  </Card.Header>

  <Card.Content class="flex max-h-[480px] flex-1 flex-col gap-3 overflow-y-auto pr-1">
    {#each filteredRules as rule}
      {@const excluded = excludedTypes.has(rule.type)}
      <div
        class={cn(
          "flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4",
          excluded && "opacity-60",
        )}
      >
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <Checkbox
            checked={!excluded}
            onCheckedChange={() => toggle(rule.type)}
            aria-label={excluded ? "启用规则" : "禁用规则"}
          />
          <div class="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {#each rule.domains as domain}<code
                class="select-all rounded-md border bg-background px-2 py-0.5 text-xs font-semibold"
                >{domain}</code
              >{/each}
          </div>
        </div>
        <Badge variant={excluded ? "secondary" : "default"}>{excluded ? "已排除" : "已启用"}</Badge>
      </div>
    {:else}
      <Empty.Root class="h-full border border-dashed"
        ><Empty.Header
          ><Empty.Media variant="icon"><Search /></Empty.Media><Empty.Title
            >未找到匹配的全局规则</Empty.Title
          ><Empty.Description>请尝试其他域名关键词。</Empty.Description></Empty.Header
        ></Empty.Root
      >
    {/each}
  </Card.Content>
</Card.Root>
