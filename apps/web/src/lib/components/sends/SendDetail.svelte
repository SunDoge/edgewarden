<script lang="ts">
import { Button } from "$lib/components/ui/button/index.js";
import { Badge } from "$lib/components/ui/badge/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import {
	Check,
	Copy,
	ExternalLink,
	File as FileIcon,
	FileText,
	Trash2,
} from "@lucide/svelte";
import { match } from "ts-pattern";
import type { DecryptedSend } from "$lib/services/send-crypto";

let {
	send,
	copied = false,
	onCopy,
	onEdit,
	onDelete,
}: {
	send: DecryptedSend;
	copied?: boolean;
	onCopy: () => void;
	onEdit: () => void;
	onDelete: () => void;
} = $props();

let sendType = $derived(
	match(send.type)
		.with(0, () => ({ label: "安全文本", icon: FileText }))
		.with(1, () => ({ label: "安全文件", icon: FileIcon }))
		.otherwise(() => ({ label: "安全分享", icon: FileText })),
);
let TypeIcon = $derived(sendType.icon);

function openShareLink() {
	window.open(
		`${window.location.origin}/sends/${send.accessId}#${send.shareKey}`,
		"_blank",
		"noopener,noreferrer",
	);
}
</script>

<div class="flex flex-col gap-6">
	<div class="flex items-center gap-3">
		<div class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
			<TypeIcon />
		</div>
		<div class="min-w-0 flex-1">
			<h3 class="truncate text-lg font-bold">{send.name}</h3>
			<p class="text-xs text-muted-foreground">{sendType.label}</p>
		</div>
	</div>

	<Separator />

	<div class="flex flex-col gap-4">
		<Field.Field>
			<Field.Label for="send-share-link">传输链接（分享给其他人）</Field.Label>
			<div class="flex items-center gap-2">
				<Input id="send-share-link" readonly value={`${window.location.origin}/sends/${send.accessId}#${send.shareKey}`} class="font-mono text-xs" />
				<Button variant="outline" size="icon" onclick={onCopy} class="shrink-0" aria-label="复制分享链接">
					{#if copied}<Check class="text-primary" />{:else}<Copy />{/if}
				</Button>
			</div>
		</Field.Field>

		<div class="grid grid-cols-2 gap-4">
			<Card.Root><Card.Header class="gap-1 p-3"><Card.Description>访问统计</Card.Description><Card.Title class="text-lg">{send.accessCount}{#if send.maxAccessCount} / {send.maxAccessCount}{/if} 次</Card.Title></Card.Header></Card.Root>
			<Card.Root><Card.Header class="gap-1 p-3"><Card.Description>到期物理销毁</Card.Description><Card.Title class="text-sm">{new Date(send.deletionDate).toLocaleDateString()}</Card.Title></Card.Header></Card.Root>
		</div>

		<Card.Root>
			<Card.Header class="pb-3"><Card.Title class="text-sm">安全属性</Card.Title></Card.Header>
			<Card.Content class="flex flex-col gap-3 text-sm">
				<div class="flex items-center justify-between"><span class="text-muted-foreground">密码保护</span><Badge variant={send.password ? "default" : "secondary"}>{send.password ? "启用" : "未启用"}</Badge></div>
				<Separator />
				<div class="flex items-center justify-between"><span class="text-muted-foreground">链接状态</span><Badge variant={send.disabled ? "destructive" : "secondary"}>{send.disabled ? "已禁用" : "正常"}</Badge></div>
				<Separator />
				<div class="flex items-center justify-between"><span class="text-muted-foreground">发送者标识</span><Badge variant="outline">{send.hideEmail ? "已隐藏" : "公开"}</Badge></div>
			</Card.Content>
		</Card.Root>

		{#if send.type === 0 && send.text?.text}<Card.Root><Card.Header class="pb-3"><Card.Title class="text-sm">文本内容</Card.Title></Card.Header><Card.Content><pre class="whitespace-pre-wrap break-words text-sm">{send.text.text}</pre></Card.Content></Card.Root>{/if}
		{#if send.type === 1 && send.file}<Card.Root><Card.Header class="pb-3"><Card.Title class="text-sm">文件</Card.Title></Card.Header><Card.Content><p class="text-sm font-medium">{send.file.fileName || "加密文件"}</p><p class="text-xs text-muted-foreground">{send.file.sizeName || ""}</p></Card.Content></Card.Root>{/if}
		{#if send.notes}<Card.Root><Card.Header class="pb-3"><Card.Title class="text-sm">备注</Card.Title></Card.Header><Card.Content><p class="whitespace-pre-wrap text-sm">{send.notes}</p></Card.Content></Card.Root>{/if}
		<div class="flex justify-between text-sm"><span class="text-muted-foreground">过期时间</span><span>{send.expirationDate ? new Date(send.expirationDate).toLocaleString() : "永不过期"}</span></div>
	</div>

	<div class="flex gap-2 pt-4">
		<Button variant="outline" size="icon" onclick={openShareLink} aria-label="打开分享链接"><ExternalLink /></Button>
		<Button variant="outline" class="flex-1 font-semibold" onclick={onEdit}>修改设置</Button>
		<Button variant="destructive" size="icon" class="shrink-0" onclick={onDelete} aria-label="删除 Send"><Trash2 /></Button>
	</div>
</div>
