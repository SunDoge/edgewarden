<script lang="ts">
import { onMount } from "svelte";
import { match } from "ts-pattern";
import { goto } from "$app/navigation";
import {
	fetchSendsApi,
	deleteSendApi,
	deleteSendsApi,
} from "$lib/services/api";
import { vault } from "$lib/stores/vault.svelte";
import { decryptOwnedSend } from "$lib/services/send-crypto";
import { saveOwnedSend } from "$lib/services/send-actions";
import {
	createSendEditorDraft,
	sendToEditorDraft,
} from "$lib/services/send-editor";
import { Button } from "$lib/components/ui/button/index.js";
import * as Alert from "$lib/components/ui/alert/index.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import * as Empty from "$lib/components/ui/empty/index.js";
import SendEditorForm from "$lib/components/sends/SendEditorForm.svelte";
import SendDetail from "$lib/components/sends/SendDetail.svelte";
import { Input } from "$lib/components/ui/input/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
import { cn } from "$lib/utils";
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
let editor = $state(createSendEditorDraft());

let copiedId = $state<string | null>(null);
let errorMsg = $state("");
let deleteTarget = $state<
	{ kind: "single"; id: string } | { kind: "bulk" } | null
>(null);

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
		if (!cached.length) errorMsg = "加载 Send 列表失败：" + (e.message || e);
	} finally {
		loading = false;
	}
}

// Filtered Sends
let filteredSends = $derived(
	sends.filter((item) => {
		const matchesType = match(typeFilter)
			.with("text", () => item.type === 0)
			.with("file", () => item.type === 1)
			.otherwise(() => true);
		if (!matchesType) return false;
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
	editor = createSendEditorDraft();
}

function startEdit(send: any) {
	selectedSend = send;
	isEditing = true;
	isCreating = false;
	mobileDetailOpen = true;
	editor = sendToEditorDraft(send);
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
	loading = true;
	try {
		await saveOwnedSend({
			form: editor,
			selectedSend,
			isCreating,
			isEditing,
			vaultKeys: { encKey: vault.symEncKey!, macKey: vault.symMacKey! },
		});

		isCreating = false;
		isEditing = false;
		selectedSend = null;
		await loadSends();
	} catch (e: any) {
		errorMsg = "保存失败：" + (e.message || e);
	} finally {
		loading = false;
	}
}

async function handleDeleteSend(sendId: string) {
	loading = true;
	try {
		await deleteSendApi(sendId);
		selectedSend = null;
		await loadSends();
	} catch (e: any) {
		errorMsg = "删除失败：" + (e.message || e);
	} finally {
		loading = false;
	}
}

async function handleBulkDelete() {
	if (!selectedIdList.length) return;
	loading = true;
	try {
		await deleteSendsApi(selectedIdList);
		selectedIds = {};
		selectedSend = null;
		await loadSends();
	} catch (e: any) {
		errorMsg = "批量删除失败：" + (e.message || e);
	} finally {
		loading = false;
	}
}

async function confirmDelete() {
	if (!deleteTarget) return;
	const target = deleteTarget;
	deleteTarget = null;
	await match(target)
		.with({ kind: "single" }, ({ id }) => handleDeleteSend(id))
		.with({ kind: "bulk" }, () => handleBulkDelete())
		.exhaustive();
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

<div class="flex min-h-screen flex-col bg-muted/30">
	<!-- Navbar -->
	<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-2 sm:px-4 md:px-6">
		<div class="flex items-center gap-2.5">
			<Button variant="ghost" size="sm" onclick={() => goto("/vault")} class="mr-1" aria-label="返回保险库">
				<ArrowLeft />
				<span class="hidden sm:inline">返回保险库</span>
			</Button>
			<Separator orientation="vertical" class="h-4" />
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
				aria-label="刷新 Send"
			>
				{#if loading}<Spinner />{:else}<RefreshCw data-icon />{/if}
			</Button>
		</div>
	</header>

	<div class="relative flex flex-1 overflow-hidden">
		<!-- Left Panel: Sends List -->
		<section class="{mobileDetailOpen ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col overflow-hidden border-r border-border bg-background">
			{#if errorMsg}<div class="p-3"><Alert.Root variant="destructive"><Alert.Title>操作失败</Alert.Title><Alert.Description>{errorMsg}</Alert.Description></Alert.Root></div>{/if}
			<div class="flex shrink-0 items-center gap-2 border-b border-border p-3 sm:gap-3 sm:p-4">
				<div class="relative flex-1">
					<Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input type="search" placeholder="搜索您创建的分享..." class="pl-10" bind:value={searchQuery} />
				</div>
				<Button class="shrink-0 font-semibold" onclick={startCreate} aria-label="新建 Send">
					<Plus data-icon="inline-start" />
					<span class="hidden sm:inline">新建 Send</span>
				</Button>
			</div>
			<div class="flex items-center gap-2 border-b px-4 py-2">
				<ToggleGroup.Root type="single" size="sm" value={typeFilter} onValueChange={(value) => { if (value) typeFilter = value as typeof typeFilter; }}>{#each [["all", "全部"], ["text", "文本"], ["file", "文件"]] as option}<ToggleGroup.Item value={option[0]}>{option[1]}</ToggleGroup.Item>{/each}</ToggleGroup.Root>
				<span class="flex-1"></span>
				{#if selectedIdList.length}<Button size="sm" variant="destructive" onclick={() => deleteTarget = { kind: "bulk" }}><Trash2 data-icon="inline-start" />删除 {selectedIdList.length} 项</Button>{/if}
			</div>

			<div class="flex-1 divide-y overflow-y-auto">
				{#if loading && sends.length === 0}
					<Empty.Root><Empty.Header><Empty.Media><Spinner class="size-8" /></Empty.Media><Empty.Title>正在加载 Send</Empty.Title><Empty.Description>正在解密并整理你的安全分享。</Empty.Description></Empty.Header></Empty.Root>
				{:else if filteredSends.length === 0}
					<Empty.Root><Empty.Header><Empty.Media variant="icon"><Share2 /></Empty.Media><Empty.Title>暂无分享文件或文本</Empty.Title><Empty.Description>创建安全链接，随时随地发送加密文本和文件。</Empty.Description></Empty.Header><Empty.Content><Button onclick={startCreate}><Plus data-icon="inline-start" />新建 Send</Button></Empty.Content></Empty.Root>
				{:else}
					{#each filteredSends as send}
						<div role="button" tabindex="0"
							class={cn("flex w-full items-center justify-between border-l-2 border-transparent p-4 text-left transition-colors hover:bg-muted/50", selectedSend?.id === send.id && "border-primary bg-muted/60")}
							onclick={() => selectSend(send)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") selectSend(send); }}
						>
							<div class="flex items-center gap-3.5 min-w-0 flex-1">
								<Checkbox checked={Boolean(selectedIds[send.id])} onclick={(event) => event.stopPropagation()} onCheckedChange={(checked) => selectedIds = { ...selectedIds, [send.id]: checked }} aria-label={`选择 ${send.name}`} />
								<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
									{#if send.type === 0}
										<FileText class="size-5" />
									{:else}
										<FileIcon class="size-5" />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
									<h4 class="truncate text-sm font-semibold">{send.name}</h4>
									{#if send.disabled}
										<Badge variant="secondary">已禁用</Badge>
										{/if}
									</div>
									<p class="mt-0.5 truncate text-xs text-muted-foreground">
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
										<Check data-icon="inline-start" />
										<span class="hidden sm:inline">已复制</span>
									{:else}
										<Copy data-icon="inline-start" />
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
					bind:form={editor}
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
					onDelete={() => deleteTarget = { kind: "single", id: selectedSend.id }}
				/>
			{:else}
				<Empty.Root class="h-full"><Empty.Header><Empty.Media variant="icon"><Share2 /></Empty.Media><Empty.Title>选择一个 Send 查看传输详情</Empty.Title><Empty.Description>您创建的任何阅后即焚内容将在此列出，并附带管理统计。</Empty.Description></Empty.Header></Empty.Root>
			{/if}
		</section>
	</div>
</div>

<AlertDialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open) deleteTarget = null; }}>
	<AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>确认删除 Send</AlertDialog.Title><AlertDialog.Description>{deleteTarget?.kind === "bulk" ? `将永久删除选中的 ${selectedIdList.length} 个 Send。` : "此 Send 将被永久删除。"} 此操作无法撤销。</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action class="bg-destructive text-destructive-foreground hover:bg-destructive/90" onclick={confirmDelete}>确认删除</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content>
</AlertDialog.Root>
