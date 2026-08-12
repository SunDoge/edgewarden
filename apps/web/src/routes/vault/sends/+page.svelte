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
import { encryptBw, encryptBwFileData } from "$lib/services/crypto";
import {
	createSendKeys,
	decryptOwnedSend,
	encryptSendMetadata,
	wrapSendKey,
	type SendKeys,
} from "$lib/services/send-crypto";
import { Button } from "$lib/components/ui/button/index.js";
import SendEditorForm from "$lib/components/sends/SendEditorForm.svelte";
import SendDetail from "$lib/components/sends/SendDetail.svelte";
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
} from "@lucide/svelte";

// State
let sends = $state<any[]>([]);
let loading = $state(true);
let searchQuery = $state("");
let typeFilter = $state<"all" | "text" | "file">("all");
let selectedIds = $state<Record<string, boolean>>({});
let selectedSend = $state<any | null>(null);
let mobileDetailOpen = $state(false);

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
	if (vault.isOffline) {
		loading = false;
		return;
	}
	try {
		const res = await fetchSendsApi();
		const decryptedList = [];
		for (const send of res.data) {
			try {
				decryptedList.push(
					await decryptOwnedSend(send, vault.symEncKey!, vault.symMacKey!),
				);
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
let selectedIdList = $derived(
	Object.keys(selectedIds).filter((id) => selectedIds[id]),
);

function startCreate() {
	isEditing = false;
	isCreating = true;
	mobileDetailOpen = true;
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
	mobileDetailOpen = true;
	sendType = send.type;
	sendName = send.name;
	sendNotes = send.notes ?? "";
	textContent = send.text?.text ?? "";
	maxAccessCount = send.maxAccessCount ?? null;
	expirationDate = send.expirationDate
		? new Date(send.expirationDate).toISOString().slice(0, 16)
		: "";
	deletionDays = Math.max(
		1,
		Math.min(
			30,
			Math.ceil(
				(new Date(send.deletionDate).getTime() - Date.now()) / 86_400_000,
			),
		),
	);
	sendPassword = "";
	protectWithPassword = Boolean(send.password);
	hideEmail = Boolean(send.hideEmail);
	disabled = Boolean(send.disabled);
}

function cancelEdit() {
	isCreating = false;
	isEditing = false;
	if (!selectedSend) mobileDetailOpen = false;
}

function selectSend(send: any) {
	selectedSend = send;
	isCreating = false;
	isEditing = false;
	mobileDetailOpen = true;
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
		const keys: SendKeys = isEditing
			? selectedSend._sendKeys
			: createSendKeys();
		const encrypted = await encryptSendMetadata(
			{
				name: sendName,
				notes: sendNotes,
				...(sendType === 0 ? { text: textContent } : {}),
			},
			keys,
		);
		const encryptedSendKey = isEditing
			? selectedSend.key
			: await wrapSendKey(keys, vault.symEncKey!, vault.symMacKey!);

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
			if (selectedSend.password && !protectWithPassword)
				await removeSendPasswordApi(selectedSend.id);
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
	if (
		!selectedIdList.length ||
		!confirm(`删除选中的 ${selectedIdList.length} 个 Send？此操作无法恢复。`)
	)
		return;
	loading = true;
	try {
		await deleteSendsApi(selectedIdList);
		selectedIds = {};
		selectedSend = null;
		await loadSends();
	} catch (e: any) {
		alert("批量删除失败：" + (e.message || e));
	} finally {
		loading = false;
	}
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
	<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-2 sm:px-4 md:px-6">
		<div class="flex items-center gap-2.5">
			<Button variant="ghost" size="sm" onclick={() => goto("/vault")} class="mr-1" aria-label="返回保险库">
				<ArrowLeft />
				<span class="hidden sm:inline">返回保险库</span>
			</Button>
			<span class="h-4 w-px bg-slate-200 dark:bg-slate-800"></span>
			<span class="flex items-center gap-2 text-base font-bold sm:text-lg">
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

	<div class="relative flex flex-1 overflow-hidden">
		<!-- Left Panel: Sends List -->
		<section class="{mobileDetailOpen ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col overflow-hidden border-r border-border bg-background">
			<div class="flex shrink-0 items-center gap-2 border-b border-border p-3 sm:gap-3 sm:p-4">
				<div class="relative flex-1">
					<Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
					<Input type="search" placeholder="搜索您创建的分享..." class="pl-10" bind:value={searchQuery} />
				</div>
				<Button class="shrink-0 font-semibold" onclick={startCreate} aria-label="新建 Send">
					<Plus class="size-4" />
					<span class="hidden sm:inline">新建 Send</span>
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

							<div class="ml-2 flex shrink-0 items-center gap-2 sm:ml-4">
								<Button
									variant="outline"
									size="sm"
									class="size-8 gap-1.5 p-0 text-xs font-semibold sm:h-8 sm:w-auto sm:px-3"
									onclick={(e) => { e.stopPropagation(); copyShareLink(send); }}
									aria-label={copiedId === send.id ? "链接已复制" : `复制 ${send.name} 的链接`}
								>
									{#if copiedId === send.id}
										<Check class="size-3 text-green-500" />
										<span class="hidden sm:inline">已复制</span>
									{:else}
										<Copy class="size-3" />
										<span class="hidden sm:inline">复制链接</span>
									{/if}
								</Button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</section>

		<!-- Right Panel: Send Details / Form Editor -->
		<section class="{mobileDetailOpen ? 'flex' : 'hidden'} absolute inset-0 z-10 w-full flex-col overflow-y-auto border-l bg-background p-4 md:static md:flex md:w-96 md:shrink-0 md:p-6">
			<div class="mb-4 md:hidden"><Button variant="ghost" size="sm" onclick={() => { if (isCreating || isEditing) cancelEdit(); else mobileDetailOpen = false; }}><ArrowLeft />返回列表</Button></div>
			{#if isCreating || isEditing}
				<SendEditorForm
					{isCreating}
					{isEditing}
					bind:sendType
					bind:name={sendName}
					bind:textContent
					bind:file={fileToUpload}
					bind:maxAccessCount
					bind:expirationDate
					bind:deletionDays
					bind:password={sendPassword}
					bind:protectWithPassword
					bind:hideEmail
					bind:disabled
					hasExistingPassword={Boolean(selectedSend?.password)}
					onSave={handleSaveSend}
						onCancel={cancelEdit}
				/>
			{:else if selectedSend}
				<SendDetail
					send={selectedSend}
					copied={copiedId === selectedSend.id}
					onCopy={() => copyShareLink(selectedSend)}
					onEdit={() => startEdit(selectedSend)}
					onDelete={() => handleDeleteSend(selectedSend.id)}
				/>
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
