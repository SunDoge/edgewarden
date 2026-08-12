<script lang="ts">
import { Button } from "$lib/components/ui/button/index.js";
import {
	Check,
	Copy,
	ExternalLink,
	File as FileIcon,
	FileText,
	Trash2,
} from "@lucide/svelte";

let {
	send,
	copied = false,
	onCopy,
	onEdit,
	onDelete,
}: {
	send: any;
	copied?: boolean;
	onCopy: () => void;
	onEdit: () => void;
	onDelete: () => void;
} = $props();

function openShareLink() {
	window.open(
		`${window.location.origin}/sends/${send.accessId}#${send.shareKey}`,
		"_blank",
		"noopener,noreferrer",
	);
}
</script>

<div class="space-y-6">
	<div class="flex items-center gap-3">
		<div class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
			{#if send.type === 0}<FileText class="size-6" />{:else}<FileIcon class="size-6" />{/if}
		</div>
		<div class="min-w-0 flex-1">
			<h3 class="truncate text-lg font-bold text-slate-900 dark:text-slate-100">{send.name}</h3>
			<p class="text-xs text-slate-400">{send.type === 0 ? "安全文本" : "安全文件"}</p>
		</div>
	</div>

	<hr class="border-slate-200 dark:border-slate-800" />

	<div class="space-y-4">
		<div class="space-y-1">
			<span class="text-xs font-semibold text-slate-400">传输链接 (分享给其他人)</span>
			<div class="flex items-center gap-2">
				<input type="text" readonly value={`${window.location.origin}/sends/${send.accessId}#${send.shareKey}`} class="w-full rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs text-slate-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800" />
				<Button variant="outline" size="icon" onclick={onCopy} class="size-9 shrink-0">
					{#if copied}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
				</Button>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
				<span class="mb-0.5 block text-xs text-slate-400">访问统计</span>
				<span class="text-lg font-bold text-slate-800 dark:text-slate-100">{send.accessCount}{#if send.maxAccessCount} / {send.maxAccessCount}{/if} 次</span>
			</div>
			<div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
				<span class="mb-0.5 block text-xs text-slate-400">到期物理销毁</span>
				<span class="mt-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{new Date(send.deletionDate).toLocaleDateString()}</span>
			</div>
		</div>

		<div class="space-y-3 rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-800/50">
			<span class="block text-xs font-bold uppercase tracking-wider text-slate-500">安全属性</span>
			<div class="flex items-center justify-between text-sm"><span class="text-slate-500">密码保护</span><span class="font-medium text-slate-700 dark:text-slate-300">{send.password ? "启用" : "未启用"}</span></div>
			<div class="flex items-center justify-between border-t border-slate-200 pt-2 text-sm dark:border-slate-800"><span class="text-slate-500">链接状态</span><span class="font-medium text-slate-700 dark:text-slate-300">{send.disabled ? "已禁用" : "正常"}</span></div>
			<div class="flex items-center justify-between border-t border-slate-200 pt-2 text-sm dark:border-slate-800"><span class="text-slate-500">发送者标识</span><span class="font-medium text-slate-700 dark:text-slate-300">{send.hideEmail ? "已隐藏" : "公开"}</span></div>
		</div>

		{#if send.type === 0 && send.text?.text}<div class="rounded-xl border bg-white p-4 dark:bg-slate-800"><div class="mb-2 text-xs font-bold uppercase text-slate-400">文本内容</div><pre class="whitespace-pre-wrap break-words text-sm">{send.text.text}</pre></div>{/if}
		{#if send.type === 1 && send.file}<div class="rounded-xl border bg-white p-4 text-sm dark:bg-slate-800"><div class="mb-2 text-xs font-bold uppercase text-slate-400">文件</div><div>{send.file.fileName || "加密文件"}</div><div class="text-xs text-slate-400">{send.file.sizeName || ""}</div></div>{/if}
		{#if send.notes}<div class="rounded-xl border bg-white p-4 dark:bg-slate-800"><div class="mb-2 text-xs font-bold uppercase text-slate-400">备注</div><p class="whitespace-pre-wrap text-sm">{send.notes}</p></div>{/if}
		<div class="flex justify-between text-sm"><span class="text-slate-500">过期时间</span><span>{send.expirationDate ? new Date(send.expirationDate).toLocaleString() : "永不过期"}</span></div>
	</div>

	<div class="flex gap-2 pt-4">
		<Button variant="outline" size="icon" onclick={openShareLink} aria-label="打开分享链接"><ExternalLink /></Button>
		<Button variant="outline" class="flex-1 font-semibold" onclick={onEdit}>修改设置</Button>
		<Button variant="ghost" class="shrink-0 border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 dark:border-red-950/50 dark:hover:bg-red-950/20" onclick={onDelete}><Trash2 class="size-4" /></Button>
	</div>
</div>
