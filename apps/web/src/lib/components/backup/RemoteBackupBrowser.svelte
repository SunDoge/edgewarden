<script lang="ts">
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Empty from "$lib/components/ui/empty/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as Table from "$lib/components/ui/table/index.js";
import { formatFileSize } from "$lib/services/backup-display";
import type { RemoteBackupItem } from "$lib/services/backup-types";
import {
  Download,
  FileArchive,
  Folder,
  Info,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "@lucide/svelte";

let {
  items,
  browsing,
  downloading,
  deleting,
  inspecting,
  restoring,
  onRefresh,
  onOpenDirectory,
  onInspect,
  onDownload,
  onRestore,
  onDelete,
}: {
  items: RemoteBackupItem[];
  browsing: boolean;
  downloading: string | null;
  deleting: string | null;
  inspecting: string | null;
  restoring: boolean;
  onRefresh: () => void;
  onOpenDirectory: (path: string) => void;
  onInspect: (path: string) => void;
  onDownload: (path: string, name: string) => void;
  onRestore: (path: string) => void;
  onDelete: (path: string) => void;
} = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>存储服务器备份浏览器</Card.Title>
		<Card.Description>浏览远端归档，可直接还原或清理历史记录</Card.Description>
		<Card.Action><Button size="icon-sm" variant="outline" onclick={onRefresh} disabled={browsing} aria-label="刷新远端备份">{#if browsing}<Spinner />{:else}<RefreshCw />{/if}</Button></Card.Action>
	</Card.Header>

	<Card.Content>
		<Table.Root>
			<Table.Header><Table.Row><Table.Head>文件名</Table.Head><Table.Head>文件大小</Table.Head><Table.Head>上次修改时间</Table.Head><Table.Head class="text-right">操作</Table.Head></Table.Row></Table.Header>
			<Table.Body>
				{#each items as item (item.path)}
					<Table.Row>
						<Table.Cell class="font-mono text-xs"><div class="flex items-center gap-2">
							{#if item.isDirectory}<Folder class="size-4 text-amber-500" />{:else}<FileArchive class="size-4 text-primary/70" />{/if}
							{#if item.isDirectory}<Button variant="link" class="h-auto p-0 font-mono text-xs" onclick={() => onOpenDirectory(item.path)}>{item.name}</Button>{:else}<span>{item.name}</span>{/if}
						</div></Table.Cell>
						<Table.Cell class="text-muted-foreground">{item.isDirectory ? "--" : formatFileSize(item.size)}</Table.Cell>
						<Table.Cell class="text-xs text-muted-foreground">{item.modifiedAt ? new Date(item.modifiedAt).toLocaleString("zh-CN") : "--"}</Table.Cell>
						<Table.Cell><div class="flex items-center justify-end gap-1.5">
							{#if !item.isDirectory}
								<Button variant="ghost" size="icon-sm" onclick={() => onInspect(item.path)} disabled={inspecting === item.path} aria-label="验证完整性">{#if inspecting === item.path}<Spinner />{:else}<ShieldCheck />{/if}</Button>
								<Button variant="ghost" size="icon-sm" onclick={() => onDownload(item.path, item.name)} disabled={downloading === item.path} aria-label="下载备份">{#if downloading === item.path}<Spinner />{:else}<Download />{/if}</Button>
								<Button variant="outline" size="sm" onclick={() => onRestore(item.path)} disabled={restoring}>{#if restoring}<Spinner data-icon="inline-start" />{/if}全量恢复</Button>
								<Button variant="destructive" size="icon-sm" onclick={() => onDelete(item.path)} disabled={deleting === item.path} aria-label="删除备份">{#if deleting === item.path}<Spinner />{:else}<Trash2 />{/if}</Button>
							{/if}
						</div></Table.Cell>
					</Table.Row>
				{/each}
				{#if items.length === 0}<Table.Row><Table.Cell colspan={4}><Empty.Root>{#if browsing}<Empty.Media variant="icon"><Spinner /></Empty.Media><Empty.Header><Empty.Title>正在检索文件列表</Empty.Title></Empty.Header>{:else}<Empty.Media variant="icon"><Info /></Empty.Media><Empty.Header><Empty.Title>暂无备份文件</Empty.Title><Empty.Description>此目录为空，或当前目的地没有读取权限。</Empty.Description></Empty.Header>{/if}</Empty.Root></Table.Cell></Table.Row>{/if}
			</Table.Body>
		</Table.Root>
	</Card.Content>
</Card.Root>
