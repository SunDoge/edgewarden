<script lang="ts">
import { Check, Copy, Eye, EyeOff } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";

let {
	card,
	copiedField,
	onCopy,
}: {
	card: Record<string, any>;
	copiedField: string | null;
	onCopy: (value: string, field: string) => void;
} = $props();
let showCode = $state(false);
</script>

<div class="flex flex-col gap-4">
	{#if card?.cardholderName}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">持卡人</span><div class="rounded-lg border bg-background p-2.5 text-sm font-medium">{card.cardholderName}</div></div>{/if}
	{#if card?.number}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">卡号</span><div class="flex items-center justify-between rounded-lg border bg-background p-2"><span class="truncate pr-2 font-mono text-sm">{card.number.replace(/(.{4})/g, "$1 ").trim()}</span><Button variant="ghost" size="icon" onclick={() => onCopy(card.number, "card")} aria-label="复制卡号">{#if copiedField === "card"}<Check />{:else}<Copy />{/if}</Button></div></div>{/if}
	{#if card?.brand}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">卡片品牌</span><div class="rounded-lg border bg-background p-2.5 text-sm font-medium">{card.brand}</div></div>{/if}
	{#if card?.expMonth || card?.expYear}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">有效期</span><div class="rounded-lg border bg-background p-2.5 text-sm font-medium">{card.expMonth ?? ""}/{card.expYear ?? ""}</div></div>{/if}
	{#if card?.code}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">安全码 (CVV)</span><div class="flex items-center justify-between rounded-lg border bg-background p-2"><span class="truncate pr-2 font-mono text-sm">{showCode ? card.code : "•••"}</span><div class="flex shrink-0 gap-1"><Button variant="ghost" size="icon" onclick={() => showCode = !showCode} aria-label={showCode ? "隐藏安全码" : "显示安全码"}>{#if showCode}<EyeOff />{:else}<Eye />{/if}</Button><Button variant="ghost" size="icon" onclick={() => onCopy(card.code, "card-code")} aria-label="复制安全码">{#if copiedField === "card-code"}<Check />{:else}<Copy />{/if}</Button></div></div></div>{/if}
</div>
