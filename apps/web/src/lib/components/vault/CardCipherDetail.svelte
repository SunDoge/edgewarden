<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { Check, Copy, Eye, EyeOff } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { VaultCardData } from "$lib/services/vault-types";

  let {
    card,
    copiedField,
    onCopy,
  }: {
    card: VaultCardData | null;
    copiedField: string | null;
    onCopy: (value: string, field: string) => void;
  } = $props();
  let showCode = $state(false);
</script>

<div class="flex flex-col gap-4">
  {#if card?.cardholderName}
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-muted-foreground">{m.ui_cardholder()}</span>
      <div class="rounded-lg border bg-background p-2.5 text-sm font-medium">
        {card.cardholderName}
      </div>
    </div>
  {/if}
  {#if card?.number}
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-muted-foreground">{m.ui_card_number()}</span>
      <div class="flex items-center justify-between rounded-lg border bg-background p-2">
        <span class="truncate pr-2 font-mono text-sm">
          {card.number.replace(/(.{4})/g, "$1 ").trim()}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onclick={() => onCopy(card.number ?? "", "card")}
          aria-label={m.ui_copy_card_number()}
        >
          {#if copiedField === "card"}<Check />{:else}<Copy />{/if}
        </Button>
      </div>
    </div>
  {/if}
  {#if card?.brand}
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-muted-foreground">{m.ui_brand()}</span>
      <div class="rounded-lg border bg-background p-2.5 text-sm font-medium">{card.brand}</div>
    </div>
  {/if}
  {#if card?.expMonth || card?.expYear}
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-muted-foreground">{m.ui_expiration()}</span>
      <div class="rounded-lg border bg-background p-2.5 text-sm font-medium">
        {card.expMonth ?? ""}/{card.expYear ?? ""}
      </div>
    </div>
  {/if}
  {#if card?.code}
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-muted-foreground">{m.ui_security_code_cvv()}</span>
      <div class="flex items-center justify-between rounded-lg border bg-background p-2">
        <span class="truncate pr-2 font-mono text-sm">{showCode ? card.code : "•••"}</span>
        <div class="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            onclick={() => (showCode = !showCode)}
            aria-label={showCode ? m.ui_hide_security_code() : m.ui_show_security_code()}
          >
            {#if showCode}<EyeOff />{:else}<Eye />{/if}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onclick={() => onCopy(card.code ?? "", "card-code")}
            aria-label={m.ui_copy_security_code()}
          >
            {#if copiedField === "card-code"}<Check />{:else}<Copy />{/if}
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>
