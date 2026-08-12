<script lang="ts">
import { Check, Copy } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";

let { identity, copiedField, onCopy }: {
	identity: Record<string, any>;
	copiedField: string | null;
	onCopy: (value: string, field: string) => void;
} = $props();
const copyFields = $derived([
	["用户名", identity?.username, "id-username"],
	["电子邮箱", identity?.email, "id-email"],
	["电话号码", identity?.phone, "id-phone"],
	["证件号码", identity?.number, "id-number"],
] as const);
let fullAddress = $derived(
	[identity?.address1, identity?.address2, identity?.address3, identity?.city, identity?.state, identity?.postalCode, identity?.country].filter(Boolean).join(", "),
);
</script>

<div class="flex flex-col gap-4">
	{#if identity?.firstName || identity?.lastName}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">姓名</span><div class="rounded-lg border bg-background p-2.5 text-sm font-medium">{identity.lastName ?? ""} {identity.firstName ?? ""}</div></div>{/if}
	{#each copyFields as [label, value, field]}{#if value}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">{label}</span><div class="flex items-center justify-between rounded-lg border bg-background p-2"><span class="truncate pr-2 text-sm font-medium">{value}</span><Button variant="ghost" size="icon" onclick={() => onCopy(value, field)} aria-label={`复制${label}`}>{#if copiedField === field}<Check />{:else}<Copy />{/if}</Button></div></div>{/if}{/each}
	{#if identity?.company}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">公司 / 组织</span><div class="rounded-lg border bg-background p-2.5 text-sm font-medium">{identity.company}</div></div>{/if}
	{#if fullAddress}<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">地址</span><div class="rounded-lg border bg-background p-2.5 text-sm font-medium leading-relaxed">{fullAddress}</div></div>{/if}
</div>
