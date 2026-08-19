<script lang="ts">
import { Server } from "@lucide/svelte";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { formatFileSize } from "$lib/services/backup-display";
import type { BackupDestinationRecord } from "./types";

let {
  destination,
  currentPath,
  running,
  browsing,
  onRun,
  onOpenParent,
}: {
  destination: BackupDestinationRecord | undefined;
  currentPath: string;
  running: boolean;
  browsing: boolean;
  onRun: () => void;
  onOpenParent: () => void;
} = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>备份任务状态</Card.Title>
		<Card.Description>查看最后一次备份触发运行的结果和时间</Card.Description>
		<Card.Action><Button size="sm" onclick={onRun} disabled={running}>{#if running}<Spinner data-icon="inline-start" />正在备份上传...{:else}<Server data-icon="inline-start" />立即执行备份{/if}</Button></Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		<div class="flex items-center gap-2 text-xs"><Button variant="outline" size="sm" onclick={onOpenParent} disabled={!currentPath || browsing}>上一级</Button><code class="rounded bg-muted px-2 py-1">/{currentPath}</code></div>
		<div class="grid grid-cols-1 gap-x-6 gap-y-3.5 text-sm md:grid-cols-2">
			<div class="flex justify-between border-b py-1"><span class="text-muted-foreground">上次运行时间：</span><span class="font-medium">{destination?.runtime.lastAttemptAt ? new Date(destination.runtime.lastAttemptAt).toLocaleString("zh-CN") : "从未运行"}</span></div>
			<div class="flex justify-between border-b py-1"><span class="text-muted-foreground">上次成功备份时间：</span><span class="font-medium">{destination?.runtime.lastSuccessAt ? new Date(destination.runtime.lastSuccessAt).toLocaleString("zh-CN") : "从未成功"}</span></div>
			<div class="flex justify-between border-b py-1 md:col-span-2"><span class="font-medium text-muted-foreground">上次生成的文件名：</span><span class="font-mono text-xs">{destination?.runtime.lastUploadedFileName || "--"}</span></div>
			<div class="flex justify-between border-b py-1"><span class="text-muted-foreground">备份文件大小：</span><span class="font-medium">{formatFileSize(destination?.runtime.lastUploadedSizeBytes)}</span></div>
			<div class="flex items-center justify-between border-b py-1"><span class="font-medium text-muted-foreground">运行状态结果：</span>{#if destination?.runtime.lastErrorAt}<Badge variant="destructive" class="max-w-[65%] truncate" title={destination.runtime.lastErrorMessage}>错误：{destination.runtime.lastErrorMessage}</Badge>{:else if destination?.runtime.lastSuccessAt}<Badge>正常</Badge>{:else}<Badge variant="secondary">无状态信息</Badge>{/if}</div>
		</div>
	</Card.Content>
</Card.Root>
