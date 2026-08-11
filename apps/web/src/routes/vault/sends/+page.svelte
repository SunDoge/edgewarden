<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import {
	fetchSendsApi,
	createSendApi,
	createFileSendApi,
	updateSendApi,
	deleteSendApi,
	deleteSendsApi,
	removeSendPasswordApi,
} from "$lib/services/api";
import { vault } from "$lib/stores/vault.svelte";
import {
	encryptBw,
	encryptBwFileData,
} from "$lib/services/crypto";
import { createSendKeys, decryptOwnedSend, encryptSendMetadata, wrapSendKey, type SendKeys } from "$lib/services/send-crypto";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import {
	Search,
	Plus,
	LogOut,
	Star,
	ShieldCheck,
	RefreshCw,
	Trash2,
	ArrowLeft,
	Share2,
	FileText,
	File as FileIcon,
	Copy,
	Check,
	Lock,
	Unlock,
	Eye,
	EyeOff,
	ExternalLink,
} from "@lucide/svelte";

// State
let sends = $state<any[]>([]);
let loading = $state(true);
let searchQuery = $state("");
let typeFilter = $state<"all" | "text" | "file">("all");
let selectedIds = $state<Record<string, boolean>>({});
let selectedSend = $state<any | null>(null);

// Form editor state
let isCreating = $state(false);
let isEditing = $state(false);
let sendType = $state(0); // 0 = Text, 1 = File
let sendName = $state("");
let sendNotes = $state("");
let textContent = $state("");
let fileToUpload = $state<File | null>(null);

// Options
let maxAccessCount = $state<number | null>(null);
let expirationDate = $state<string>("");
let deletionDays = $state<number>(7); // Default 7 days
let sendPassword = $state("");
let protectWithPassword = $state(false);
let hideEmail = $state(false);
let disabled = $state(false);

let showPassword = $state(false);
let copiedId = $state<string | null>(null);

onMount(async () => {
	if (!vault.isUnlocked) {
		goto("/vault/unlock");
		return;
	}
	await loadSends();
});

async function loadSends() {
	loading = true;
	const cached = vault.sends;
	if (cached.length) sends = [...cached];
	if (vault.isOffline) { loading = false; return; }
	try {
		const res = await fetchSendsApi();
		const decryptedList = [];
		for (const send of res.data) {
			try {
				decryptedList.push(await decryptOwnedSend(send, vault.symEncKey!, vault.symMacKey!));
			} catch (e) {
				console.error("Failed to decrypt send:", send.id, e);
			}
		}
		sends = decryptedList;
	} catch (e: any) {
		if (!cached.length) alert("加载 Send 列表失败：" + (e.message || e));
	} finally {
		loading = false;
	}
}

// Filtered Sends
let filteredSends = $derived(
	sends.filter((item) => {
		if (typeFilter === "text" && item.type !== 0) return false;
		if (typeFilter === "file" && item.type !== 1) return false;
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			return (
				item.name.toLowerCase().includes(q) ||
				(item.notes ?? "").toLowerCase().includes(q)
			);
		}
		return true;
	}),
);
let selectedIdList = $derived(Object.keys(selectedIds).filter((id) => selectedIds[id]));

function startCreate() {
	isEditing = false;
	isCreating = true;
	sendType = 0;
	sendName = "";
	sendNotes = "";
	textContent = "";
	fileToUpload = null;
	maxAccessCount = null;
	expirationDate = "";
	deletionDays = 7;
	sendPassword = "";
	protectWithPassword = false;
	hideEmail = false;
	disabled = false;
}

function startEdit(send: any) {
	selectedSend = send;
	isEditing = true;
	isCreating = false;
	sendType = send.type;
	sendName = send.name;
	sendNotes = send.notes ?? "";
	textContent = send.text?.text ?? "";
	maxAccessCount = send.maxAccessCount ?? null;
	expirationDate = send.expirationDate ? new Date(send.expirationDate).toISOString().slice(0, 16) : "";
	deletionDays = Math.max(1, Math.min(30, Math.ceil((new Date(send.deletionDate).getTime() - Date.now()) / 86_400_000)));
	sendPassword = "";
	protectWithPassword = Boolean(send.password);
	hideEmail = Boolean(send.hideEmail);
	disabled = Boolean(send.disabled);
}

function cancelEdit() {
	isCreating = false;
	isEditing = false;
}

function selectSend(send: any) {
	selectedSend = send; isCreating = false; isEditing = false;
}

function handleFileChange(e: Event) {
	const target = e.target as HTMLInputElement;
	if (target.files && target.files.length > 0) {
		fileToUpload = target.files[0];
		if (!sendName) {
			sendName = fileToUpload.name;
		}
	}
}

async function handleSaveSend() {
	if (!sendName.trim()) {
		alert("名称不能为空！");
		return;
	}

	if (sendType === 0 && !textContent.trim()) {
		alert("文本内容不能为空！");
		return;
	}

	if (sendType === 1 && !fileToUpload && isCreating) {
		alert("请选择要上传的文件！");
		return;
	}
	if (isCreating && protectWithPassword && !sendPassword) {
		alert("启用密码保护时必须输入访问密码！");
		return;
	}

	loading = true;
	try {
		const keys: SendKeys = isEditing ? selectedSend._sendKeys : createSendKeys();
		const encrypted = await encryptSendMetadata({ name: sendName, notes: sendNotes, ...(sendType === 0 ? { text: textContent } : {}) }, keys);
		const encryptedSendKey = isEditing ? selectedSend.key : await wrapSendKey(keys, vault.symEncKey!, vault.symMacKey!);

		// Calculate Deletion Date
		const deletionDate = new Date(
			Date.now() + deletionDays * 24 * 60 * 60 * 1000,
		).toISOString();

		let payload: any = {
			type: sendType,
			name: encrypted.name,
			notes: encrypted.notes,
			key: encryptedSendKey,
			deletionDate,
			maxAccessCount: maxAccessCount || null,
			expirationDate: expirationDate
				? new Date(expirationDate).toISOString()
				: null,
			disabled,
			hideEmail,
		};

		if (protectWithPassword && sendPassword) {
			payload.authType = 1;
			payload.password = sendPassword;
		} else if (!protectWithPassword) {
			payload.authType = 2;
		}

		if (isCreating) {
			if (sendType === 0) {
				// Text Send
				payload.text = encrypted.text;

				await createSendApi(payload);
			} else if (sendType === 1 && fileToUpload) {
				// File Send
				const fileBytes = new Uint8Array(await fileToUpload.arrayBuffer());
				const encryptedFileBytes = await encryptBwFileData(
					fileBytes,
					keys.enc,
					keys.mac,
				);

				const encryptedFileName = await encryptBw(
					new TextEncoder().encode(fileToUpload.name),
					keys.enc,
					keys.mac,
				);
				payload.file = {
					fileName: encryptedFileName,
					sizeName: `${(fileBytes.length / 1024 / 1024).toFixed(2)} MB`,
				};
				payload.fileLength = encryptedFileBytes.length;

				// 1. Create File Send entry on server
				const res = await createFileSendApi(payload);

				// 2. Upload file payload directly to KV/R2 using the direct upload url
				const uploadResp = await fetch(res.url, {
					method: "PUT",
					body: new Blob([encryptedFileBytes as any]),
					headers: {
						"Content-Type": "application/octet-stream",
					},
				});

				if (!uploadResp.ok) {
					throw new Error(`文件 payload 上传失败: ${uploadResp.status}`);
				}
			}
		} else if (isEditing && selectedSend) {
			// Update text/options
			if (sendType === 0) {
				payload.text = encrypted.text;
			}
			await updateSendApi(selectedSend.id, payload);
			if (selectedSend.password && !protectWithPassword) await removeSendPasswordApi(selectedSend.id);
		}

		isCreating = false;
		isEditing = false;
		selectedSend = null;
		await loadSends();
	} catch (e: any) {
		alert("保存失败：" + (e.message || e));
	} finally {
		loading = false;
	}
}

async function handleDeleteSend(sendId: string) {
	if (!confirm("确定要删除此分享传输吗？此操作无法恢复！")) return;
	loading = true;
	try {
		await deleteSendApi(sendId);
		selectedSend = null;
		await loadSends();
	} catch (e: any) {
		alert("删除失败：" + (e.message || e));
	} finally {
		loading = false;
	}
}

async function handleBulkDelete() {
	if (!selectedIdList.length || !confirm(`删除选中的 ${selectedIdList.length} 个 Send？此操作无法恢复。`)) return;
	loading = true;
	try { await deleteSendsApi(selectedIdList); selectedIds = {}; selectedSend = null; await loadSends(); }
	catch (e: any) { alert("批量删除失败：" + (e.message || e)); }
	finally { loading = false; }
}

function copyShareLink(send: any) {
	const origin = window.location.origin;
	const link = `${origin}/sends/${send.accessId}#${send.shareKey}`;
	navigator.clipboard.writeText(link);
	copiedId = send.id;
	setTimeout(() => {
		if (copiedId === send.id) copiedId = null;
	}, 2000);
}
</script>

<svelte:head>
	<title>Send 传输中心 - Edgewarden</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
	<!-- Navbar -->
	<header class="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between shrink-0">
		<div class="flex items-center gap-2.5">
			<Button variant="ghost" size="sm" onclick={() => goto("/vault")} class="mr-1">
				<ArrowLeft class="size-4 mr-2" />
				返回保险库
			</Button>
			<span class="h-4 w-px bg-slate-200 dark:bg-slate-800"></span>
			<span class="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
				<Share2 class="size-5 text-primary" />
				Send 传输中心
			</span>
		</div>

		<div class="flex items-center gap-2">
			<Button
				variant="ghost" size="sm"
				onclick={loadSends}
				disabled={loading}
				class="text-slate-500"
			>
				<RefreshCw class="size-4 {loading ? 'animate-spin' : ''}" />
			</Button>
		</div>
	</header>

	<div class="flex-1 flex overflow-hidden">
		<!-- Left Panel: Sends List -->
		<section class="flex-1 flex flex-col bg-white dark:bg-slate-900 overflow-hidden border-r border-slate-200 dark:border-slate-800">
			<div class="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 shrink-0">
				<div class="relative flex-1">
					<Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
					<Input type="search" placeholder="搜索您创建的分享..." class="pl-10" bind:value={searchQuery} />
				</div>
				<Button class="gap-2 shrink-0 bg-primary text-primary-foreground font-semibold" onclick={startCreate}>
					<Plus class="size-4" />
					新建 Send
				</Button>
			</div>
			<div class="flex items-center gap-2 border-b px-4 py-2">
				{#each [["all", "全部"], ["text", "文本"], ["file", "文件"]] as option}<Button size="sm" variant={typeFilter === option[0] ? "secondary" : "ghost"} onclick={() => typeFilter = option[0] as typeof typeFilter}>{option[1]}</Button>{/each}
				<span class="flex-1"></span>
				{#if selectedIdList.length}<Button size="sm" variant="destructive" onclick={handleBulkDelete}><Trash2 />删除 {selectedIdList.length} 项</Button>{/if}
			</div>

			<div class="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
				{#if loading && sends.length === 0}
					<div class="p-8 text-center text-slate-500">
						<div class="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-3"></div>
						<span>正在加载您的 Send 列表...</span>
					</div>
				{:else if filteredSends.length === 0}
					<div class="p-12 text-center text-slate-400">
						<Share2 class="size-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
						<p class="font-medium text-sm">暂无分享文件或文本</p>
						<p class="text-xs text-slate-500 mt-1">创建安全链接，随时随地给任何人发送文本和文件。</p>
					</div>
				{:else}
					{#each filteredSends as send}
						<div role="button" tabindex="0"
							class="w-full p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/30 text-left transition-colors
								{selectedSend?.id === send.id ? 'bg-primary/5 dark:bg-primary/10 border-l-2 border-primary' : 'border-l-2 border-transparent'}"
							onclick={() => selectSend(send)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") selectSend(send); }}
						>
							<div class="flex items-center gap-3.5 min-w-0 flex-1">
								<input type="checkbox" checked={Boolean(selectedIds[send.id])} onclick={(event) => event.stopPropagation()} onchange={(event) => selectedIds = { ...selectedIds, [send.id]: event.currentTarget.checked }} aria-label={`选择 ${send.name}`} />
								<div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center shrink-0">
									{#if send.type === 0}
										<FileText class="size-5" />
									{:else}
										<FileIcon class="size-5" />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{send.name}</h4>
										{#if send.disabled}
											<span class="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">已禁用</span>
										{/if}
									</div>
									<p class="text-xs text-slate-400 truncate mt-0.5">
										{send.type === 0 ? "加密文本" : "加密文件"} • 已访问 {send.accessCount} 次
									</p>
								</div>
							</div>

							<div class="flex items-center gap-2 shrink-0 ml-4">
								<Button
									variant="outline"
									size="sm"
									class="gap-1.5 text-xs font-semibold"
									onclick={(e) => { e.stopPropagation(); copyShareLink(send); }}
								>
									{#if copiedId === send.id}
										<Check class="size-3 text-green-500" />
										已复制
									{:else}
										<Copy class="size-3" />
										复制链接
									{/if}
								</Button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</section>

		<!-- Right Panel: Send Details / Form Editor -->
		<section class="w-96 bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shrink-0 overflow-y-auto p-6">
			{#if isCreating || isEditing}
				<div class="space-y-5">
					<div class="flex items-center justify-between">
						<h3 class="font-bold text-lg text-slate-900 dark:text-slate-100">
							{isCreating ? "新建安全 Send" : "编辑 Send"}
						</h3>
						<Button variant="ghost" size="sm" onclick={cancelEdit} class="text-slate-500 hover:text-red-500">
							取消
						</Button>
					</div>

					<hr class="border-slate-200 dark:border-slate-800" />

					<div class="space-y-4">
						{#if isCreating}
							<div class="space-y-1.5">
								<span class="text-xs font-bold text-slate-400 uppercase tracking-wider">分享类型</span>
								<div class="grid grid-cols-2 gap-2">
									<button
										class="py-2.5 rounded-lg border text-sm font-semibold flex items-center justify-center gap-2 transition-colors
											{sendType === 0 ? 'bg-primary border-primary text-primary-foreground' : 'bg-white dark:bg-slate-800 border-slate-200 text-slate-650 hover:bg-slate-50'}"
										onclick={() => sendType = 0}
									>
										<FileText class="size-4" />
										加密文本
									</button>
									<button
										class="py-2.5 rounded-lg border text-sm font-semibold flex items-center justify-center gap-2 transition-colors
											{sendType === 1 ? 'bg-primary border-primary text-primary-foreground' : 'bg-white dark:bg-slate-800 border-slate-200 text-slate-650 hover:bg-slate-50'}"
										onclick={() => sendType = 1}
									>
										<FileIcon class="size-4" />
										加密文件
									</button>
								</div>
							</div>
						{/if}

						<div class="space-y-1.5">
							<span class="text-xs font-bold text-slate-400 uppercase tracking-wider">分享名称</span>
							<Input bind:value={sendName} placeholder="例如: 财务表格或密码备份" />
						</div>

						{#if sendType === 0}
							<div class="space-y-1.5">
								<span class="text-xs font-bold text-slate-400 uppercase tracking-wider">文本内容</span>
								<textarea
									bind:value={textContent}
									rows="6"
									placeholder="在此输入需要发送的敏感文字内容（客户端加密传输）..."
									class="w-full p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-y"
								></textarea>
							</div>
						{:else if sendType === 1 && isCreating}
							<div class="space-y-1.5">
								<span class="text-xs font-bold text-slate-400 uppercase tracking-wider">选择文件</span>
								<input
									type="file"
									class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600"
									onchange={handleFileChange}
								/>
							</div>
						{/if}

						<div class="space-y-4 border-t border-slate-250 dark:border-slate-800 pt-4">
							<span class="text-xs font-bold text-slate-400 uppercase tracking-wider block">安全与失效选项</span>

							<div class="space-y-1.5">
								<span class="text-xs font-semibold text-slate-500">限次失效 (最大访问次数)</span>
								<Input type="number" min="1" bind:value={maxAccessCount} placeholder="例如：1 (留空则不限)" />
							</div>

							<div class="space-y-1.5">
								<span class="text-xs font-semibold text-slate-500">自动销毁时间 (最长 30 天)</span>
								<select bind:value={deletionDays} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
									<option value={1}>1 天后硬删除</option>
									<option value={3}>3 天后硬删除</option>
									<option value={7}>7 天后硬删除</option>
									<option value={14}>14 天后硬删除</option>
									<option value={30}>30 天后硬删除</option>
								</select>
							</div>

							<div class="space-y-1.5">
								<span class="text-xs font-semibold text-slate-500">过期时间 (此时间后禁止下载，但保留记录)</span>
								<input
									type="datetime-local"
									bind:value={expirationDate}
									class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
								/>
							</div>

							<div class="space-y-1.5">
								<label class="flex items-center gap-2 text-xs font-semibold text-slate-500"><input type="checkbox" bind:checked={protectWithPassword} class="size-4 rounded" />启用访问密码</label>
								<div class="relative">
									<Input
										type={showPassword ? "text" : "password"}
										bind:value={sendPassword}
										placeholder={isEditing && selectedSend?.password ? "留空以保留现有密码" : "输入访问密码"}
										disabled={!protectWithPassword}
										class="pr-10"
									/>
									<button
										type="button"
										class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650"
										onclick={() => (showPassword = !showPassword)}
									>
										{#if showPassword}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
									</button>
								</div>
							</div>

							<div class="flex items-center gap-2 py-1">
								<input type="checkbox" id="hideEmail" bind:checked={hideEmail} class="rounded border-slate-300 text-primary focus:ring-primary size-4" />
								<label for="hideEmail" class="text-sm font-semibold text-slate-600 cursor-pointer">隐藏我的邮箱地址</label>
							</div>

							<div class="flex items-center gap-2 py-1">
								<input type="checkbox" id="disabled" bind:checked={disabled} class="rounded border-slate-300 text-primary focus:ring-primary size-4" />
								<label for="disabled" class="text-sm font-semibold text-slate-600 cursor-pointer">立即禁用此链接</label>
							</div>
						</div>
					</div>

					<Button onclick={handleSaveSend} class="w-full bg-primary text-primary-foreground font-semibold py-2.5">
						创建并加密传输
					</Button>
				</div>
			{:else if selectedSend}
				<div class="space-y-6">
					<div class="flex items-center gap-3">
						<div class="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
							{#if selectedSend.type === 0}
								<FileText class="size-6" />
							{:else}
								<FileIcon class="size-6" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<h3 class="font-bold text-lg text-slate-900 dark:text-slate-100 truncate">{selectedSend.name}</h3>
							<p class="text-xs text-slate-400">{selectedSend.type === 0 ? "安全文本" : "安全文件"}</p>
						</div>
					</div>

					<hr class="border-slate-200 dark:border-slate-800" />

					<div class="space-y-4">
						<div class="space-y-1">
							<span class="text-xs font-semibold text-slate-400">传输链接 (分享给其他人)</span>
							<div class="flex items-center gap-2">
								<input
									type="text"
									readonly
									value={`${window.location.origin}/sends/${selectedSend.accessId}#${selectedSend.shareKey}`}
									class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-600 focus:outline-none"
								/>
								<Button variant="outline" size="icon" onclick={() => copyShareLink(selectedSend)} class="shrink-0 size-9">
									{#if copiedId === selectedSend.id}
										<Check class="size-4 text-green-500" />
									{:else}
										<Copy class="size-4 text-slate-400" />
									{/if}
								</Button>
							</div>
						</div>

						<div class="grid grid-cols-2 gap-4">
							<div class="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
								<span class="text-xs text-slate-400 block mb-0.5">访问统计</span>
								<span class="font-bold text-lg text-slate-800 dark:text-slate-100">
									{selectedSend.accessCount} {#if selectedSend.maxAccessCount} / {selectedSend.maxAccessCount}{/if} 次
								</span>
							</div>

							<div class="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
								<span class="text-xs text-slate-400 block mb-0.5">到期物理销毁</span>
								<span class="font-semibold text-xs text-slate-600 dark:text-slate-350 block mt-1">
									{new Date(selectedSend.deletionDate).toLocaleDateString()}
								</span>
							</div>
						</div>

						<div class="space-y-3 bg-slate-100 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
							<span class="text-xs font-bold text-slate-500 uppercase tracking-wider block">安全属性</span>
							<div class="flex justify-between items-center text-sm">
								<span class="text-slate-500">密码保护</span>
								<span class="font-medium text-slate-700 dark:text-slate-300">
									{selectedSend.password ? "启用" : "未启用"}
								</span>
							</div>
							<div class="flex justify-between items-center text-sm border-t border-slate-200 dark:border-slate-800 pt-2">
								<span class="text-slate-500">链接状态</span>
								<span class="font-medium text-slate-700 dark:text-slate-300">
									{selectedSend.disabled ? "已禁用" : "正常"}
								</span>
							</div>
							<div class="flex justify-between items-center text-sm border-t border-slate-200 dark:border-slate-800 pt-2">
								<span class="text-slate-500">发送者标识</span>
								<span class="font-medium text-slate-700 dark:text-slate-300">
									{selectedSend.hideEmail ? "已隐藏" : "公开"}
								</span>
							</div>
						</div>
						{#if selectedSend.type === 0 && selectedSend.text?.text}<div class="rounded-xl border bg-white p-4 dark:bg-slate-800"><div class="mb-2 text-xs font-bold uppercase text-slate-400">文本内容</div><pre class="whitespace-pre-wrap break-words text-sm">{selectedSend.text.text}</pre></div>{/if}
						{#if selectedSend.type === 1 && selectedSend.file}<div class="rounded-xl border bg-white p-4 text-sm dark:bg-slate-800"><div class="mb-2 text-xs font-bold uppercase text-slate-400">文件</div><div>{selectedSend.file.fileName || "加密文件"}</div><div class="text-xs text-slate-400">{selectedSend.file.sizeName || ""}</div></div>{/if}
						{#if selectedSend.notes}<div class="rounded-xl border bg-white p-4 dark:bg-slate-800"><div class="mb-2 text-xs font-bold uppercase text-slate-400">备注</div><p class="whitespace-pre-wrap text-sm">{selectedSend.notes}</p></div>{/if}
						<div class="flex justify-between text-sm"><span class="text-slate-500">过期时间</span><span>{selectedSend.expirationDate ? new Date(selectedSend.expirationDate).toLocaleString() : "永不过期"}</span></div>
					</div>

					<div class="flex gap-2 pt-4">
						<Button variant="outline" size="icon" onclick={() => window.open(`${window.location.origin}/sends/${selectedSend.accessId}#${selectedSend.shareKey}`, "_blank", "noopener,noreferrer")} aria-label="打开分享链接"><ExternalLink /></Button>
						<Button variant="outline" class="flex-1 font-semibold" onclick={() => startEdit(selectedSend)}>
							修改设置
						</Button>
						<Button variant="ghost" class="text-red-500 hover:text-red-650 hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-200 dark:border-red-950/50 shrink-0" onclick={() => handleDeleteSend(selectedSend.id)}>
							<Trash2 class="size-4" />
						</Button>
					</div>
				</div>
			{:else}
				<div class="h-full flex flex-col items-center justify-center text-center text-slate-400 p-8">
					<Share2 class="size-10 text-slate-300 dark:text-slate-700 mb-3" />
					<p class="font-medium text-sm">选择一个 Send 查看传输详情</p>
					<p class="text-xs text-slate-500 mt-1">您创建的任何阅后即焚内容将在此列出，并附带管理统计。</p>
				</div>
			{/if}
		</section>
	</div>
</div>
