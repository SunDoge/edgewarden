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
import LoginCipherDetail from "./LoginCipherDetail.svelte";
import {
	cipherDomain as getDomain,
	cipherExtraData as getExtraData,
	cipherTypeIcon as getItemIcon,
	cipherTypeName as getTypeName,
} from "$lib/services/vault-item-display";

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
	item: any;
	folders: Array<{ id: string; name: string }>;
	totp: { code: string; remain: number } | null;
	attachmentBusy: string | null;
	onFavorite: () => void;
	onArchive: () => void;
	onRestore: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onAttachmentUpload: (event: Event) => void;
	onAttachmentDownload: (attachment: any) => void;
	onAttachmentDelete: (attachment: any) => void;
} = $props();

let copiedField = $state<string | null>(null);
let showCardCode = $state(false);
let hiddenFieldsMap = $state<Record<number, boolean>>({});
let attachmentInput = $state<HTMLInputElement | null>(null);
let IconComp = $derived(getItemIcon(item.type));

$effect(() => {
	item.id;
	showCardCode = false;
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

				<div class="space-y-6 animate-in fade-in duration-200">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3 min-w-0">
							<div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center shrink-0 overflow-hidden relative border border-slate-200/50 dark:border-slate-850">
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
											if (fallback) fallback.classList.remove("hidden");
										}}
										style="opacity: 0; transition: opacity 0.2s;"
									/>
									<div class="absolute inset-0 flex items-center justify-center hidden">
										<IconComp class="size-6" />
									</div>
								{:else}
									<IconComp class="size-6" />
								{/if}
							</div>
							<div class="min-w-0">
								<h3 class="font-bold text-lg text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
									{item.name}
									{#if item.favorite}
										<Star class="size-4 fill-current text-amber-400 shrink-0" />
									{/if}
								</h3>
								<p class="text-xs text-slate-400 flex items-center gap-1 mt-0.5 flex-wrap">
									<span>{getTypeName(item.type)}</span>
									{#if item.folderId}
										{@const folder = folders.find(f => f.id === item.folderId)}
										{#if folder}
											<span class="text-slate-350 dark:text-slate-700">•</span>
											<span class="flex items-center gap-0.5 max-w-[120px] truncate">
												<Folder class="size-3 text-slate-450 shrink-0" />
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
								<Button variant="ghost" size="icon" onclick={onEdit} class="size-8.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="编辑"><Edit class="size-4" /></Button>
							{/if}
							{#if !item.readOnly}<Button variant="ghost" size="icon" onclick={onDelete} class="size-8.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" title="删除">
								<Trash2 class="size-4" />
							</Button>{/if}
						</div>
					</div>

					<hr class="border-slate-200 dark:border-slate-800" />

					<!-- Login -->
					{#if item.type === CipherType.Login}
						{#key item.id}<LoginCipherDetail login={item.login} hidePasswords={item.hidePasswords} {totp} />{/key}
					{/if}

					<!-- Card -->
					{#if item.type === CipherType.Card}
						{@const card = item.card as Record<string, any>}
						<div class="space-y-4">
							{#if card?.cardholderName}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">持卡人</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">{card.cardholderName}</div>
								</div>
							{/if}
							{#if card?.number}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">卡号</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-mono truncate pr-2">{card.number.replace(/(.{4})/g, "$1 ").trim()}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(card.number, "card")}>
											{#if copiedField === "card"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if card?.brand}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">卡片品牌</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">
										{card.brand}
									</div>
								</div>
							{/if}
							{#if card?.expMonth || card?.expYear}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">有效期</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">
										{card.expMonth ?? ""}/{card.expYear ?? ""}
									</div>
								</div>
							{/if}
							{#if card?.code}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">安全码 (CVV)</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-mono truncate pr-2 select-all">
											{#if showCardCode}{card.code}{:else}•••{/if}
										</span>
										<div class="flex items-center gap-1 shrink-0">
											<Button variant="ghost" size="icon" class="size-8" onclick={() => showCardCode = !showCardCode}>
												{#if showCardCode}
													<EyeOff class="size-4 text-slate-400" />
												{:else}
													<Eye class="size-4 text-slate-400" />
												{/if}
											</Button>
											<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(card.code, "card-code")}>
												{#if copiedField === "card-code"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
											</Button>
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Identity -->
					{#if item.type === CipherType.Identity}
						{@const id = item.identity as Record<string, any>}
						<div class="space-y-4">
							{#if id?.firstName || id?.lastName}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">姓名</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">
										{id.lastName ?? ""} {id.firstName ?? ""}
									</div>
								</div>
							{/if}
							{#if id?.username}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">用户名</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-medium truncate pr-2 select-all">{id.username}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(id.username, "id-username")}>
											{#if copiedField === "id-username"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if id?.email}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">电子邮箱</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-medium truncate pr-2 select-all">{id.email}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(id.email, "id-email")}>
											{#if copiedField === "id-email"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if id?.phone}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">电话号码</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-medium truncate pr-2 select-all">{id.phone}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(id.phone, "id-phone")}>
											{#if copiedField === "id-phone"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if id?.company}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">公司 / 组织</span>
									<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium">{id.company}</div>
								</div>
							{/if}
							{#if id?.number}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-400">证件号码</span>
									<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
										<span class="text-sm font-mono truncate pr-2">{id.number}</span>
										<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(id.number, "id-number")}>
											{#if copiedField === "id-number"}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
										</Button>
									</div>
								</div>
							{/if}
							{#if id?.address1 || id?.city || id?.country}
								{@const fullAddress = [id.address1, id.address2, id.address3, id.city, id.state, id.postalCode, id.country].filter(Boolean).join(", ")}
								{#if fullAddress}
									<div class="space-y-1.5">
										<span class="text-xs font-semibold text-slate-400">地址</span>
										<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border text-sm font-medium leading-relaxed">{fullAddress}</div>
									</div>
								{/if}
							{/if}
						</div>
					{/if}

					{#if getExtraData(item)}
						<div class="space-y-3">
							{#each Object.entries(getExtraData(item) ?? {}) as [key, value]}
								<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400">{key}</span><div class="flex items-center justify-between rounded-lg border bg-white p-2 dark:bg-slate-800"><span class="break-all text-sm font-mono">{String(value ?? "")}</span><Button variant="ghost" size="icon-sm" onclick={() => copyToClipboard(String(value ?? ""), `extra-${key}`)} aria-label={`复制 ${key}`}><Copy /></Button></div></div>
							{/each}
						</div>
					{/if}

					<!-- Notes -->
					{#if item.notes}
						<div class="space-y-1.5">
							<span class="text-xs font-semibold text-slate-400">便签</span>
							<div class="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm whitespace-pre-wrap leading-relaxed">
								{item.notes}
							</div>
						</div>
					{/if}

					<!-- Custom Fields -->
					{#if item.fields && item.fields.length > 0}
						<div class="border-t border-slate-200 dark:border-slate-800/80 pt-4 mt-4 space-y-4">
							<h4 class="font-bold text-xs text-slate-400 uppercase tracking-wider">自定义字段</h4>
							{#each item.fields as field, idx}
								<div class="space-y-1.5">
									<span class="text-xs font-semibold text-slate-500">{field.name || "未命名"}</span>
									
									{#if field.type === 2 || field.type === "2"}
										<div class="p-2.5 rounded-lg bg-white dark:bg-slate-800 border flex items-center gap-2">
											<input type="checkbox" checked={field.value === "true" || field.value === true} disabled class="rounded border-slate-300 text-primary size-4" />
											<span class="text-sm font-medium text-slate-700 dark:text-slate-300">
												{#if field.value === "true" || field.value === true}是{:else}否{/if}
											</span>
										</div>
									{:else if field.type === 1 || field.type === "1"}
										<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
											<span class="text-sm font-mono truncate pr-2 select-all">
												{#if hiddenFieldsMap[idx]}{field.value}{:else}••••••••••••{/if}
											</span>
											<div class="flex items-center gap-1 shrink-0">
												<Button variant="ghost" size="icon" class="size-8" onclick={() => hiddenFieldsMap[idx] = !hiddenFieldsMap[idx]}>
													{#if hiddenFieldsMap[idx]}
														<EyeOff class="size-4 text-slate-400" />
													{:else}
														<Eye class="size-4 text-slate-400" />
													{/if}
												</Button>
												<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(field.value, `field-${idx}`)}>
													{#if copiedField === `field-${idx}`}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
												</Button>
											</div>
										</div>
									{:else}
										<div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
											<span class="text-sm font-medium truncate pr-2 select-all">{field.value || ""}</span>
											<Button variant="ghost" size="icon" class="size-8" onclick={() => copyToClipboard(field.value, `field-${idx}`)}>
												{#if copiedField === `field-${idx}`}<Check class="size-4 text-green-500" />{:else}<Copy class="size-4 text-slate-400" />{/if}
											</Button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<!-- Attachments are encrypted in the browser before upload. -->
					{#if !item.deletedDate}
						<div class="border-t border-slate-200 pt-4 dark:border-slate-800/80">
							<div class="mb-3 flex items-center justify-between gap-2">
								<h4 class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400"><Paperclip class="size-3.5" />附件</h4>
								<input bind:this={attachmentInput} type="file" class="sr-only" onchange={onAttachmentUpload} aria-label="选择要上传的附件" />
								{#if !item.readOnly}<Button type="button" size="xs" variant="outline" disabled={attachmentBusy !== null} onclick={() => attachmentInput?.click()}>
									<Upload />{attachmentBusy === "upload" ? "正在加密…" : "添加附件"}
								</Button>{/if}
							</div>
							{#if item.attachments?.length}
								<div class="space-y-2">
									{#each item.attachments as attachment (attachment.id)}
										<div class="flex items-center gap-2 rounded-lg border bg-white p-2 dark:bg-slate-800">
											<Paperclip class="size-4 shrink-0 text-slate-400" />
											<div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{attachment.fileName}</p><p class="text-[11px] text-slate-400">{attachment.sizeName}</p></div>
											<Button type="button" variant="ghost" size="icon-sm" disabled={attachmentBusy !== null} onclick={() => onAttachmentDownload(attachment)} aria-label={`下载 ${attachment.fileName}`}><Download /></Button>
											{#if !item.readOnly}<Button type="button" variant="ghost" size="icon-sm" disabled={attachmentBusy !== null} onclick={() => onAttachmentDelete(attachment)} aria-label={`删除 ${attachment.fileName}`} class="text-red-500"><Trash2 /></Button>{/if}
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-xs text-slate-400">暂无附件。文件内容和文件名均在浏览器中加密。</p>
							{/if}
						</div>
					{/if}

					<!-- Item History Meta -->
					<div class="border-t border-slate-200 dark:border-slate-800/80 pt-4 mt-6 text-[11px] text-slate-400 dark:text-slate-500 space-y-1 bg-slate-50/50 dark:bg-slate-900/50 p-3 rounded-lg">
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
