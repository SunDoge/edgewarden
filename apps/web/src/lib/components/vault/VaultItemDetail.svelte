<script lang="ts">
import { CipherType } from "@edgewarden/shared";
import {
	Archive,
	ArchiveRestore,
	Check,
	Copy,
	Download,
	Edit,
	Eye,
	EyeOff,
	Folder,
	Paperclip,
	RotateCcw,
	Star,
	Trash2,
	Upload,
} from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import LoginCipherDetail from "./LoginCipherDetail.svelte";
import CardCipherDetail from "./CardCipherDetail.svelte";
import IdentityCipherDetail from "./IdentityCipherDetail.svelte";
import {
	cipherDomain as getDomain,
	cipherExtraData as getExtraData,
	cipherTypeIcon as getItemIcon,
	cipherTypeName as getTypeName,
} from "$lib/services/vault-item-display";
import type {
	VaultAttachment,
	VaultCipher,
	VaultFolder,
	VaultTotp,
} from "$lib/services/vault-types";

let {
	item,
	folders,
	totp,
	attachmentBusy,
	onFavorite,
	onArchive,
	onRestore,
	onEdit,
	onDelete,
	onAttachmentUpload,
	onAttachmentDownload,
	onAttachmentDelete,
}: {
	item: VaultCipher;
	folders: VaultFolder[];
	totp: VaultTotp | null;
	attachmentBusy: string | null;
	onFavorite: () => void;
	onArchive: () => void;
	onRestore: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onAttachmentUpload: (event: Event) => void;
	onAttachmentDownload: (attachment: VaultAttachment) => void;
	onAttachmentDelete: (attachment: VaultAttachment) => void;
} = $props();

let copiedField = $state<string | null>(null);
let hiddenFieldsMap = $state<Record<number, boolean>>({});
let attachmentInput = $state<HTMLInputElement | null>(null);
let IconComp = $derived(getItemIcon(item.type));

$effect(() => {
	item.id;
	hiddenFieldsMap = {};
});

function copyToClipboard(text: string, fieldName: string) {
	navigator.clipboard.writeText(text);
	copiedField = fieldName;
	setTimeout(() => {
		if (copiedField === fieldName) copiedField = null;
	}, 2000);
}
</script>

				<div class="flex flex-col gap-6 animate-in fade-in duration-200">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3 min-w-0">
							<div class="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-muted text-muted-foreground">
								{#if getDomain(item)}
									<img
										src="/icons/{encodeURIComponent(getDomain(item) ?? "")}/icon.png"
										alt=""
										class="size-6.5 object-contain rounded-md"
										onload={(e) => {
											(e.currentTarget as HTMLImageElement).style.opacity = "1";
										}}
										onerror={(e) => {
											const target = e.currentTarget as HTMLImageElement;
											target.style.display = "none";
											const fallback = target.nextElementSibling as HTMLElement | null;
											if (fallback) fallback.classList.remove("invisible");
										}}
										style="opacity: 0; transition: opacity 0.2s;"
									/>
									<div class="invisible absolute inset-0 flex items-center justify-center">
										<IconComp class="size-6" />
									</div>
								{:else}
									<IconComp class="size-6" />
								{/if}
							</div>
							<div class="min-w-0">
								<h3 class="flex items-center gap-1.5 truncate text-lg font-bold">
									{item.name}
									{#if item.favorite}
										<Star class="size-4 fill-current text-amber-400 shrink-0" />
									{/if}
								</h3>
								<p class="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
									<span>{getTypeName(item.type)}</span>
									{#if item.folderId}
										{@const folder = folders.find(f => f.id === item.folderId)}
										{#if folder}
											<span aria-hidden="true">•</span>
											<span class="flex items-center gap-0.5 max-w-[120px] truncate">
												<Folder class="size-3 shrink-0" />
												{folder.name}
											</span>
										{/if}
									{/if}
								</p>
							</div>
						</div>
						<div class="flex gap-1.5 shrink-0">
							{#if !item.deletedDate && !item.readOnly}<Button variant="ghost" size="icon" onclick={() => onFavorite()} class="size-8.5 rounded-lg" title={item.favorite ? "取消收藏" : "收藏"}><Star class="size-4 {item.favorite ? 'fill-current text-amber-400' : ''}" /></Button>{/if}
							{#if !item.deletedDate && !item.readOnly}<Button variant="ghost" size="icon" onclick={onArchive} class="size-8.5 rounded-lg" title={item.archivedDate ? "取消归档" : "归档"}>{#if item.archivedDate}<ArchiveRestore class="size-4" />{:else}<Archive class="size-4" />{/if}</Button>{/if}
							{#if item.deletedDate && !item.readOnly}
								<Button variant="ghost" size="icon" onclick={onRestore} class="size-8.5 rounded-lg" title="恢复"><RotateCcw class="size-4" /></Button>
							{:else if !item.readOnly}
								<Button variant="ghost" size="icon-sm" onclick={onEdit} title="编辑"><Edit /></Button>
							{/if}
							{#if !item.readOnly}<Button variant="ghost" size="icon-sm" onclick={onDelete} class="text-destructive hover:text-destructive" title="删除">
								<Trash2 />
							</Button>{/if}
						</div>
					</div>

					<Separator />

					<!-- Login -->
					{#if item.type === CipherType.Login}
						{#key item.id}<LoginCipherDetail login={item.login} hidePasswords={item.hidePasswords} {totp} />{/key}
					{/if}

					{#if item.type === CipherType.Card}<CardCipherDetail card={item.card} {copiedField} onCopy={copyToClipboard} />{/if}
					{#if item.type === CipherType.Identity}<IdentityCipherDetail identity={item.identity} {copiedField} onCopy={copyToClipboard} />{/if}
					{#if getExtraData(item)}
						<div class="flex flex-col gap-3">
							{#each Object.entries(getExtraData(item) ?? {}) as [key, value]}
								<div class="flex flex-col gap-1.5"><span class="text-xs font-semibold text-muted-foreground">{key}</span><div class="flex items-center justify-between rounded-lg border bg-background p-2"><span class="break-all text-sm font-mono">{String(value ?? "")}</span><Button variant="ghost" size="icon-sm" onclick={() => copyToClipboard(String(value ?? ""), `extra-${key}`)} aria-label={`复制 ${key}`}><Copy /></Button></div></div>
							{/each}
						</div>
					{/if}

					<!-- Notes -->
					{#if item.notes}
						<div class="flex flex-col gap-1.5">
							<span class="text-xs font-semibold text-muted-foreground">便签</span>
							<div class="rounded-lg border bg-background p-3 text-sm whitespace-pre-wrap leading-relaxed">
								{item.notes}
							</div>
						</div>
					{/if}

					<!-- Custom Fields -->
					{#if item.fields && item.fields.length > 0}
						<div class="mt-4 flex flex-col gap-4 border-t pt-4">
							<h4 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">自定义字段</h4>
							{#each item.fields as field, idx}
								<div class="flex flex-col gap-1.5">
									<span class="text-xs font-semibold text-muted-foreground">{field.name || "未命名"}</span>
									
									{#if field.type === 2 || field.type === "2"}
										<div class="flex items-center gap-2 rounded-lg border bg-background p-2.5">
											<Checkbox checked={field.value === "true" || field.value === true} disabled />
											<span class="text-sm font-medium">
												{#if field.value === "true" || field.value === true}是{:else}否{/if}
											</span>
										</div>
									{:else if field.type === 1 || field.type === "1"}
										<div class="flex items-center justify-between rounded-lg border bg-background p-2">
											<span class="text-sm font-mono truncate pr-2 select-all">
												{#if hiddenFieldsMap[idx]}{field.value}{:else}••••••••••••{/if}
											</span>
											<div class="flex items-center gap-1 shrink-0">
												<Button variant="ghost" size="icon" class="size-8" onclick={() => hiddenFieldsMap[idx] = !hiddenFieldsMap[idx]}>
													{#if hiddenFieldsMap[idx]}
												<EyeOff />
													{:else}
												<Eye />
													{/if}
												</Button>
								<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(String(field.value ?? ""), `field-${idx}`)}>
											{#if copiedField === `field-${idx}`}<Check class="text-primary" />{:else}<Copy />{/if}
												</Button>
											</div>
										</div>
									{:else}
										<div class="flex items-center justify-between rounded-lg border bg-background p-2">
											<span class="text-sm font-medium truncate pr-2 select-all">{field.value || ""}</span>
							<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(String(field.value ?? ""), `field-${idx}`)}>
										{#if copiedField === `field-${idx}`}<Check class="text-primary" />{:else}<Copy />{/if}
											</Button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<!-- Attachments are encrypted in the browser before upload. -->
					{#if !item.deletedDate}
						<div class="border-t pt-4">
							<div class="mb-3 flex items-center justify-between gap-2">
								<h4 class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Paperclip class="size-3.5" />附件</h4>
								<input bind:this={attachmentInput} type="file" class="sr-only" onchange={onAttachmentUpload} aria-label="选择要上传的附件" />
								{#if !item.readOnly}<Button type="button" size="xs" variant="outline" disabled={attachmentBusy !== null} onclick={() => attachmentInput?.click()}>
									<Upload />{attachmentBusy === "upload" ? "正在加密…" : "添加附件"}
								</Button>{/if}
							</div>
							{#if item.attachments?.length}
								<div class="flex flex-col gap-2">
									{#each item.attachments as attachment (attachment.id)}
										<div class="flex items-center gap-2 rounded-lg border bg-background p-2">
											<Paperclip class="size-4 shrink-0 text-muted-foreground" />
											<div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{attachment.fileName}</p><p class="text-xs text-muted-foreground">{attachment.sizeName}</p></div>
											<Button type="button" variant="ghost" size="icon-sm" disabled={attachmentBusy !== null} onclick={() => onAttachmentDownload(attachment)} aria-label={`下载 ${attachment.fileName}`}><Download /></Button>
											{#if !item.readOnly}<Button type="button" variant="ghost" size="icon-sm" disabled={attachmentBusy !== null} onclick={() => onAttachmentDelete(attachment)} aria-label={`删除 ${attachment.fileName}`} class="text-red-500"><Trash2 /></Button>{/if}
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">暂无附件。文件内容和文件名均在浏览器中加密。</p>
							{/if}
						</div>
					{/if}

					<!-- Item History Meta -->
					<div class="mt-6 flex flex-col gap-1 rounded-lg border-t bg-muted/50 p-3 pt-4 text-xs text-muted-foreground">
						{#if item.creationDate}
							<p class="flex justify-between">
								<span>创建时间</span>
								<span>{new Date(item.creationDate).toLocaleString("zh-CN")}</span>
							</p>
						{/if}
						{#if item.revisionDate}
							<p class="flex justify-between">
								<span>修改时间</span>
								<span>{new Date(item.revisionDate).toLocaleString("zh-CN")}</span>
							</p>
						{/if}
					</div>
				</div>
