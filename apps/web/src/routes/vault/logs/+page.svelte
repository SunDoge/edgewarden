<script lang="ts">
import {
	ArrowLeft,
	ChevronLeft,
	ChevronRight,
	RefreshCw,
	ShieldAlert,
} from "@lucide/svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import * as Alert from "$lib/components/ui/alert/index.js";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Select from "$lib/components/ui/select/index.js";
import * as Table from "$lib/components/ui/table/index.js";
import {
	fetchAuditLogSettingsApi,
	listAuditLogsApi,
	updateAuditLogSettingsApi,
} from "$lib/services/api";
import { vault } from "$lib/stores/vault.svelte";
import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";

let logs = $state<any[]>([]);
let total = $state(0);
let offset = $state(0);
let category = $state("all");
let level = $state("all");
let query = $state("");
let busy = $state(false);
let error = $state<string | null>(null);
let retentionMode = $state<"days" | "entries">("days");
let retentionDays = $state("0");
let maxEntries = $state(10000);
const limit = 50;

async function load(reset = false) {
	if (reset) offset = 0;
	busy = true;
	error = null;
	try {
		const result = await listAuditLogsApi({
			limit,
			offset,
			category: category === "all" ? undefined : category,
			level: level === "all" ? undefined : level,
			q: query.trim(),
		});
		logs = result.data;
		total = result.total;
	} catch (reason) {
		error = reason instanceof Error ? reason.message : String(reason);
	} finally {
		busy = false;
	}
}

async function loadSettings() {
	const settings = await fetchAuditLogSettingsApi();
	retentionMode = settings.maxEntries ? "entries" : "days";
	retentionDays = String(settings.retentionDays ?? 0);
	maxEntries = settings.maxEntries ?? 10000;
}

async function saveSettings() {
	busy = true;
	error = null;
	try {
		await updateAuditLogSettingsApi(
			retentionMode === "days"
				? {
						retentionDays:
							(Number(retentionDays) as 7 | 30 | 90 | 180 | 365) || null,
						maxEntries: null,
					}
				: { retentionDays: null, maxEntries },
		);
	} catch (reason) {
		error = reason instanceof Error ? reason.message : String(reason);
	} finally {
		busy = false;
	}
}

onMount(() => {
	if (vault.profile?.role !== "admin") void goto("/vault");
	else void Promise.all([load(), loadSettings()]);
});
</script>

<svelte:head><title>审计日志 - Edgewarden</title></svelte:head>

<VaultPageShell title="审计日志" description="登录、安全与管理操作记录；元数据会在服务端去除密钥和密码。" width="full">
	{#snippet actions()}<Button variant="outline" onclick={() => load()} disabled={busy}><RefreshCw data-icon="inline-start" />刷新</Button>{/snippet}
	{#if error}<Alert.Root variant="destructive"><ShieldAlert /><Alert.Title>日志操作失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
	<form class="grid items-end gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap" onsubmit={(event) => { event.preventDefault(); void load(true); }}><Field.Field class="min-w-0 flex-1 sm:col-span-2"><Field.Label for="log-query">搜索</Field.Label><Input id="log-query" bind:value={query} placeholder="操作、邮箱或元数据" /></Field.Field><Field.Field><Field.Label>类别</Field.Label><Select.Root type="single" bind:value={category}><Select.Trigger class="w-full lg:w-36">{category === "all" ? "全部" : category}</Select.Trigger><Select.Content><Select.Group><Select.Item value="all">全部</Select.Item><Select.Item value="auth">auth</Select.Item><Select.Item value="vault">vault</Select.Item><Select.Item value="admin">admin</Select.Item><Select.Item value="system">system</Select.Item><Select.Item value="org">org</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field><Field.Field><Field.Label>级别</Field.Label><Select.Root type="single" bind:value={level}><Select.Trigger class="w-full lg:w-36">{level === "all" ? "全部" : level}</Select.Trigger><Select.Content><Select.Group><Select.Item value="all">全部</Select.Item><Select.Item value="info">info</Select.Item><Select.Item value="warning">warning</Select.Item><Select.Item value="error">error</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field><Button type="submit" disabled={busy}>查询</Button></form>
	<section class="min-w-0 rounded-lg border bg-card"><div class="overflow-x-auto"><Table.Root><Table.Caption>共 {total} 条记录</Table.Caption><Table.Header><Table.Row><Table.Head>时间</Table.Head><Table.Head>级别</Table.Head><Table.Head>类别 / 操作</Table.Head><Table.Head>操作者</Table.Head><Table.Head>目标</Table.Head><Table.Head>元数据</Table.Head></Table.Row></Table.Header><Table.Body>{#each logs as log (log.id)}<Table.Row><Table.Cell class="whitespace-nowrap text-xs">{new Date(log.createdAt).toLocaleString("zh-CN")}</Table.Cell><Table.Cell><Badge variant={log.level === "error" ? "destructive" : "outline"}>{log.level}</Badge></Table.Cell><Table.Cell><p class="text-xs text-muted-foreground">{log.category}</p><p class="font-medium">{log.action}</p></Table.Cell><Table.Cell>{log.actorEmail || "系统"}</Table.Cell><Table.Cell>{[log.targetType, log.targetId].filter(Boolean).join(": ") || "—"}</Table.Cell><Table.Cell><code class="break-all text-xs">{JSON.stringify(log.metadata)}</code></Table.Cell></Table.Row>{/each}</Table.Body></Table.Root></div>{#if !logs.length && !busy}<p class="p-8 text-center text-sm text-muted-foreground">没有符合条件的日志。</p>{/if}<footer class="flex flex-wrap items-center justify-end gap-2 border-t p-3"><Button variant="outline" size="sm" disabled={offset === 0 || busy} onclick={() => { offset = Math.max(0, offset - limit); void load(); }}><ChevronLeft data-icon="inline-start" />上一页</Button><span class="text-xs text-muted-foreground">{total ? `${offset + 1}–${Math.min(total, offset + limit)} / ${total}` : "0 / 0"}</span><Button variant="outline" size="sm" disabled={offset + limit >= total || busy} onclick={() => { offset += limit; void load(); }}>下一页<ChevronRight data-icon="inline-end" /></Button></footer></section>
	<section class="rounded-lg border bg-card p-4"><Field.Group><Field.Field><Field.Label>保留策略</Field.Label><Field.Description>默认永久保留且不提供一键清空。仅在隐私政策或 D1 容量要求下显式设置有限保留。</Field.Description><Select.Root type="single" bind:value={retentionMode}><Select.Trigger>{retentionMode === "days" ? "按时间" : "按最大条数"}</Select.Trigger><Select.Content><Select.Item value="days">按时间</Select.Item><Select.Item value="entries">按最大条数</Select.Item></Select.Content></Select.Root></Field.Field>{#if retentionMode === "days"}<Field.Field><Field.Label>保留天数</Field.Label><Select.Root type="single" bind:value={retentionDays}><Select.Trigger>{retentionDays === "0" ? "永久" : `${retentionDays} 天`}</Select.Trigger><Select.Content>{#each ["0", "7", "30", "90", "180", "365"] as days}<Select.Item value={days}>{days === "0" ? "永久" : `${days} 天`}</Select.Item>{/each}</Select.Content></Select.Root></Field.Field>{:else}<Field.Field><Field.Label for="max-log-entries">最多条数</Field.Label><Input id="max-log-entries" type="number" min={100} max={1000000} bind:value={maxEntries} /></Field.Field>{/if}<Field.Field orientation="horizontal"><Button onclick={saveSettings} disabled={busy}>保存保留策略</Button></Field.Field></Field.Group></section>
</VaultPageShell>
