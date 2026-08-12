<script lang="ts">
import { Button } from "$lib/components/ui/button/index.js";
import { Check, Copy, ExternalLink, Eye, EyeOff } from "@lucide/svelte";

let {
	login,
	hidePasswords = false,
	totp,
}: {
	login: Record<string, any>;
	hidePasswords?: boolean;
	totp: { code: string; remain: number } | null;
} = $props();

let copiedField = $state<string | null>(null);
let showPassword = $state(false);
let uris = $derived(
	Array.isArray(login?.uris)
		? login.uris
		: login?.uri
			? [{ uri: login.uri }]
			: [],
);

function copy(text: string, field: string) {
	void navigator.clipboard.writeText(text);
	copiedField = field;
	setTimeout(() => {
		if (copiedField === field) copiedField = null;
	}, 2000);
}
</script>

<div class="space-y-4">
	{#if login?.username}
		<div class="space-y-1.5">
			<span class="text-xs font-semibold text-slate-400">用户名</span>
			<div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
				<span class="truncate pr-2 text-sm font-medium select-all">{login.username}</span>
				<Button variant="ghost" size="icon" class="size-8" onclick={() => copy(login.username, "username")}>{#if copiedField === "username"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}</Button>
			</div>
		</div>
	{/if}

	{#if login?.password}
		<div class="space-y-1.5">
			<span class="text-xs font-semibold text-slate-400">密码</span>
			<div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
				<span class="truncate pr-2 font-mono text-sm select-all">{showPassword && !hidePasswords ? login.password : "••••••••••••"}</span>
				{#if !hidePasswords}<div class="flex shrink-0 items-center gap-1">
					<Button variant="ghost" size="icon" class="size-8" onclick={() => showPassword = !showPassword}>{#if showPassword}<EyeOff class="size-4 text-slate-400" />{:else}<Eye class="size-4 text-slate-400" />{/if}</Button>
					<Button variant="ghost" size="icon" class="size-8" onclick={() => copy(login.password, "password")}>{#if copiedField === "password"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}</Button>
				</div>{/if}
			</div>
		</div>
	{/if}

	{#if login?.totp && !hidePasswords}
		<div class="space-y-1.5">
			<span class="text-xs font-semibold text-slate-400">单次有效密码 (TOTP)</span>
			<div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
				{#if totp}<div class="flex items-center gap-2"><span class="font-mono text-sm font-bold tracking-wider text-primary select-all">{totp.code.slice(0, 3)} {totp.code.slice(3)}</span><span class="text-xs text-slate-400">({totp.remain}s)</span></div><Button variant="ghost" size="icon" class="size-8 shrink-0" onclick={() => copy(totp?.code || "", "totp")}>{#if copiedField === "totp"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}</Button>{:else}<span class="text-xs text-slate-400">正在计算...</span>{/if}
			</div>
		</div>
	{/if}

	{#if uris.length > 0}
		<div class="space-y-2">
			<span class="text-xs font-semibold text-slate-400">{uris.length > 1 ? "网页链接列表" : "网页链接"}</span>
			{#each uris as uriItem, index}
				{#if uriItem.uri}<div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800"><a href={uriItem.uri} target="_blank" rel="noopener noreferrer" class="flex truncate pr-2 text-sm font-medium text-primary hover:underline">{uriItem.uri}<ExternalLink class="size-3 shrink-0" /></a><Button variant="ghost" size="icon" class="size-8 shrink-0" onclick={() => copy(uriItem.uri, `uri-${index}`)}>{#if copiedField === `uri-${index}`}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}</Button></div>{/if}
			{/each}
		</div>
	{/if}
</div>
