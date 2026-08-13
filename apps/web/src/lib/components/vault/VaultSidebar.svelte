<script lang="ts">
import type { FolderResponse } from "@edgewarden/shared";
import {
	Archive,
	Building2,
	Combine,
	Copy,
	CreditCard,
	Database,
	Edit,
	FileText,
	Folder,
	Globe,
	KeyRound,
	Lock,
	Plus,
	ScrollText,
	Settings,
	Share2,
	ShieldAlert,
	Star,
	Trash2,
	Upload,
	User,
	UserRoundCog,
	WandSparkles,
} from "@lucide/svelte";
import { goto } from "$app/navigation";
import { Button } from "$lib/components/ui/button/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import type { VaultCategory } from "$lib/services/vault-filter";
import { vault } from "$lib/stores/vault.svelte";

let {
	activeCategory = $bindable(),
	activeFolder = $bindable(),
	duplicateCount,
	onCreate,
	onCreateFolder,
	onRenameFolder,
	onDeleteFolder,
	onDeleteAllFolders,
	onMergeDuplicateFolders,
	duplicateFolderCount,
	mergingDuplicateFolders,
	onNavigate,
}: {
	activeCategory: VaultCategory;
	activeFolder: string | null;
	duplicateCount: number;
	onCreate: () => void;
	onCreateFolder: () => void;
	onRenameFolder: (folder: FolderResponse) => void;
	onDeleteFolder: (folder: FolderResponse) => void;
	onDeleteAllFolders: () => void;
	onMergeDuplicateFolders: () => void;
	duplicateFolderCount: number;
	mergingDuplicateFolders: boolean;
	onNavigate?: () => void;
} = $props();

const filters = $derived([
	{
		id: "all" as const,
		label: "全部条目",
		icon: Lock,
		count: vault.ciphers.filter(
			(item) => !item.deletedDate && !item.archivedDate,
		).length,
	},
	{
		id: "favorites" as const,
		label: "我的收藏",
		icon: Star,
		count: vault.ciphers.filter(
			(item) => item.favorite && !item.deletedDate && !item.archivedDate,
		).length,
	},
	{
		id: "archive" as const,
		label: "归档",
		icon: Archive,
		count: vault.ciphers.filter(
			(item) => item.archivedDate && !item.deletedDate,
		).length,
	},
	{
		id: "trash" as const,
		label: "回收站",
		icon: Trash2,
		count: vault.ciphers.filter((item) => item.deletedDate).length,
	},
	{
		id: "duplicates" as const,
		label: "重复项",
		icon: Copy,
		count: duplicateCount,
	},
]);

const cipherTypes = [
	{ id: "login" as const, label: "登录凭据", icon: KeyRound },
	{ id: "card" as const, label: "支付卡片", icon: CreditCard },
	{ id: "identity" as const, label: "个人身份", icon: User },
	{ id: "securenote" as const, label: "安全便签", icon: FileText },
];

const tools = [
	{ href: "/vault/totp", label: "验证码", icon: KeyRound },
	{ href: "/vault/password-health", label: "密码健康", icon: ShieldAlert },
	{ href: "/vault/domains", label: "域名等效规则", icon: Globe },
	{ href: "/vault/sends", label: "Send 传输中心", icon: Share2 },
	{ href: "/vault/import-export", label: "导入与导出", icon: Upload },
	{ href: "/vault/organizations", label: "组织共享", icon: Building2 },
	{ href: "/vault/settings", label: "账户与安全", icon: Settings },
	{ href: "/vault/generator", label: "密码生成器", icon: WandSparkles },
];

const adminTools = [
	{ href: "/vault/admin", label: "用户与邀请", icon: UserRoundCog },
	{ href: "/vault/logs", label: "审计日志", icon: ScrollText },
	{ href: "/vault/backups", label: "云备份中心", icon: Database },
];

function selectCategory(category: VaultCategory) {
	activeCategory = category;
	activeFolder = null;
	onNavigate?.();
}

function navigateTo(href: string) {
	onNavigate?.();
	void goto(href);
}
</script>

<aside class="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r bg-background p-4">
	<Button class="mb-6 w-full gap-2" onclick={onCreate}>
		<Plus data-icon="inline-start" />
		添加新条目
	</Button>

	<nav class="flex flex-col gap-1.5" aria-label="保险库导航">
		<p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">类型过滤</p>
		{#each filters as item (item.id)}
			<button
				class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors {activeCategory === item.id && !activeFolder ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}"
				onclick={() => selectCategory(item.id)}
			>
				<item.icon class="size-4" />
				<span>{item.label}</span>
				<span class="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{item.count}</span>
			</button>
		{/each}

		<Separator class="my-2" />
		{#each cipherTypes as item (item.id)}
			<button
				class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors {activeCategory === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}"
				onclick={() => selectCategory(item.id)}
			>
				<item.icon class="size-4" />
				<span>{item.label}</span>
			</button>
		{/each}

		<Separator class="my-2" />
		<p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">工具与设置</p>
		{#each tools as item (item.href)}
			<button class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted" onclick={() => navigateTo(item.href)}>
				<item.icon class="size-4" />
				<span>{item.label}</span>
			</button>
		{/each}

		{#if vault.profile?.role === "admin"}
			<Separator class="my-2" />
			<p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">管理</p>
			{#each adminTools as item (item.href)}
				<button class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted" onclick={() => navigateTo(item.href)}>
					<item.icon class="size-4" />
					<span>{item.label}</span>
				</button>
			{/each}
		{/if}
	</nav>

	<section class="mt-6 flex flex-col gap-1 md:hidden" aria-labelledby="folders-heading">
		<div class="mb-2 flex items-center justify-between px-3">
			<p id="folders-heading" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">文件夹</p>
			<div class="flex items-center gap-1">
				{#if duplicateFolderCount}
					<Button variant="ghost" size="icon-xs" onclick={onMergeDuplicateFolders} disabled={mergingDuplicateFolders} title={`合并 ${duplicateFolderCount} 个同名重复文件夹`} aria-label="合并同名重复文件夹"><Combine /></Button>
				{/if}
				{#if vault.folders.length}
					<button class="rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive" onclick={onDeleteAllFolders} title="删除全部文件夹"><Trash2 class="size-3.5" /></button>
				{/if}
				<button class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground" onclick={onCreateFolder} title="新建文件夹"><Plus class="size-3.5" /></button>
			</div>
		</div>
		{#each vault.folders as folder (folder.id)}
			<div class="group flex w-full items-center justify-between rounded-lg text-left text-sm font-medium transition-colors {activeFolder === folder.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}">
				<button class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left font-medium" onclick={() => { activeFolder = folder.id; activeCategory = 'all'; onNavigate?.(); }}>
					<Folder class="size-4 shrink-0" />
					<span class="truncate">{folder.name}</span>
				</button>
				<div class="flex shrink-0 items-center gap-1.5 pr-2">
					<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground group-hover:hidden">{vault.ciphers.filter((item) => item.folderId === folder.id).length}</span>
					<button class="hidden rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:inline-flex" onclick={(event) => { event.stopPropagation(); onRenameFolder(folder); }} title="重命名"><Edit class="size-3.5" /></button>
					<button class="hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:inline-flex" onclick={(event) => { event.stopPropagation(); onDeleteFolder(folder); }} title="删除"><Trash2 class="size-3.5" /></button>
				</div>
			</div>
		{:else}
			<p class="px-3 text-xs italic text-muted-foreground">暂无文件夹</p>
		{/each}
	</section>
</aside>
