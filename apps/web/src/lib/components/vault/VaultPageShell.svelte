<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  let {
    title,
    description,
    actions,
    children,
    width = "wide",
    fill = false,
  }: {
    title: string;
    description: string;
    actions?: Snippet;
    children: Snippet;
    width?: "compact" | "default" | "wide" | "full";
    fill?: boolean;
  } = $props();

  const widthClass = $derived(
    width === "compact"
      ? "max-w-3xl"
      : width === "default"
        ? "max-w-5xl"
        : width === "wide"
          ? "max-w-6xl"
          : "max-w-none",
  );
</script>

<main class={cn("w-full p-4 sm:p-6 lg:p-8", fill ? "flex h-full overflow-hidden" : "min-h-full")}>
  <div
    class={cn(
      "mx-auto flex w-full min-w-0 flex-col gap-6",
      fill && "min-h-0 flex-1 overflow-hidden",
      widthClass,
    )}
  >
    <header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold sm:text-2xl">{title}</h1>
        <p class="text-sm text-muted-foreground">{description}</p>
      </div>
      {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
    </header>
    {@render children()}
  </div>
</main>
