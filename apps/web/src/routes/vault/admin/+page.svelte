<script lang="ts">
import {
	ArrowLeft,
	Copy,
	RefreshCw,
	Search,
	ShieldAlert,
	Trash2,
	UserRoundCog,
} from "@lucide/svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import * as Alert from "$lib/components/ui/alert/index.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as Table from "$lib/components/ui/table/index.js";
import * as Tabs from "$lib/components/ui/tabs/index.js";
import { searchAdminUsers } from "$lib/services/admin-search";
import {
	createAdminInviteApi,
	deleteAdminInviteApi,
	deleteAdminUserApi,
	deriveAccountPasswordHash,
	getAdminPushRelayStatusApi,
	getAdminRegistrationPolicyApi,
	listAdminInvitesApi,
	listAdminUsersApi,
	setAdminUserStatusApi,
	updateAdminRegistrationPolicyApi,
} from "$lib/services/api";
import { vault } from "$lib/stores/vault.svelte";
import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";

let users = $state<any[]>([]);
let invites = $state<any[]>([]);
let masterPassword = $state("");
let expiresInHours = $state(168);
let inviteEmail = $state("");
let busy = $state<string | null>(null);
let error = $state<string | null>(null);
let signupsAllowed = $state(false);
let invitationsAllowed = $state(true);
let pushRelay = $state<{
	enabled: boolean;
	region: "US" | "EU";
	installationIdConfigured: boolean;
	installationKeyConfigured: boolean;
	reason: "ready" | "missing_credentials" | "invalid_region";
} | null>(null);
let userSearchQuery = $state("");
let deleteUser = $state<any>(null);
const filteredUsers = $derived(searchAdminUsers(users, userSearchQuery));

async function refresh() {
	busy = "refresh";
	error = null;
	try {
		const [nextUsers, nextInvites, policy, nextPushRelay] = await Promise.all([
			listAdminUsersApi().then((r) => r.data),
			listAdminInvitesApi().then((r) => r.data),
			getAdminRegistrationPolicyApi(),
			getAdminPushRelayStatusApi(),
		]);
		users = nextUsers;
		invites = nextInvites;
		signupsAllowed = policy.signupsAllowed;
		invitationsAllowed = policy.invitationsAllowed;
		pushRelay = nextPushRelay;
	} catch (reason) {
		error = reason instanceof Error ? reason.message : String(reason);
	} finally {
		busy = null;
	}
}

async function passwordHash() {
	if (!masterPassword) throw new Error("请输入当前主密码以确认管理操作");
	const email = vault.profile?.email;
	if (!email) throw new Error("账户资料尚未载入");
	return deriveAccountPasswordHash(email, masterPassword);
}

async function run(key: string, operation: (hash: string) => Promise<unknown>) {
	busy = key;
	error = null;
	try {
		await operation(await passwordHash());
		masterPassword = "";
		await refresh();
	} catch (reason) {
		error = reason instanceof Error ? reason.message : String(reason);
	} finally {
		busy = null;
	}
}

async function createInvite() {
	await run("invite-create", async (hash) => {
		const invite = await createAdminInviteApi(
			hash,
			inviteEmail,
			expiresInHours,
		);
		await navigator.clipboard.writeText(invite.inviteLink);
		inviteEmail = "";
	});
}

async function saveRegistrationPolicy() {
	await run("registration-policy", (hash) =>
		updateAdminRegistrationPolicyApi(hash, signupsAllowed, invitationsAllowed),
	);
}

async function confirmDeleteUser() {
	if (!deleteUser) return;
	const user = deleteUser;
	deleteUser = null;
	await run(`delete-${user.id}`, (hash) => deleteAdminUserApi(user.id, hash));
}

onMount(() => {
	if (vault.profile?.role !== "admin") void goto("/vault");
	else void refresh();
});
</script>

<svelte:head><title>用户管理 - Edgewarden</title></svelte:head>

<VaultPageShell title="用户与邀请" description="敏感管理操作需要重新输入主密码。">
	{#snippet actions()}<Button variant="outline" onclick={refresh} disabled={busy !== null}><RefreshCw data-icon="inline-start" />刷新</Button>{/snippet}
	{#if error}<Alert.Root variant="destructive"><ShieldAlert /><Alert.Title>管理操作失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
	<Field.Group><Field.Field><Field.Label for="admin-password">当前主密码</Field.Label><Input id="admin-password" type="password" bind:value={masterPassword} autocomplete="current-password" /><Field.Description>仅用于在浏览器中派生验证摘要，不会保存。</Field.Description></Field.Field></Field.Group>

	<Tabs.Root value="users" class="flex flex-col gap-4">
		<Tabs.List class="grid h-auto w-full grid-cols-3"><Tabs.Trigger value="users">用户</Tabs.Trigger><Tabs.Trigger value="registration">注册与邀请</Tabs.Trigger><Tabs.Trigger value="operations">运行状态</Tabs.Trigger></Tabs.List>
		<Tabs.Content value="registration" class="mt-0 flex flex-col gap-6">
	<section class="rounded-lg border bg-card p-4"><div class="flex flex-col gap-4"><div><h2 class="font-semibold">注册策略</h2><p class="text-xs text-muted-foreground">修改后立即写入 D1，并覆盖部署变量提供的默认值。</p></div><Field.Group><Field.Field orientation="horizontal"><Field.Content><Field.Label for="public-signups">允许公开注册</Field.Label><Field.Description>无需邀请码即可创建普通账户。</Field.Description></Field.Content><Switch id="public-signups" bind:checked={signupsAllowed} disabled={busy !== null} /></Field.Field><Field.Field orientation="horizontal"><Field.Content><Field.Label for="invite-signups">允许邀请码注册</Field.Label><Field.Description>关闭后，已有邀请码也不能用于注册。</Field.Description></Field.Content><Switch id="invite-signups" bind:checked={invitationsAllowed} disabled={busy !== null} /></Field.Field></Field.Group><Button class="self-start" onclick={saveRegistrationPolicy} disabled={busy !== null || !masterPassword}>保存注册策略</Button></div></section>

	<section class="min-w-0 rounded-lg border bg-card"><header class="flex flex-col items-stretch justify-between gap-3 border-b p-4 lg:flex-row lg:items-end"><div><h2 class="font-semibold">邀请码</h2><p class="text-xs text-muted-foreground">邀请码只能由指定邮箱注册，创建后会自动复制注册链接。</p></div><div class="grid items-end gap-2 sm:grid-cols-[1fr_7rem_auto]"><Field.Field><Field.Label for="invite-email">受邀邮箱</Field.Label><Input id="invite-email" type="email" bind:value={inviteEmail} placeholder="name@example.com" required /></Field.Field><Field.Field><Field.Label for="invite-hours">有效小时数</Field.Label><Input id="invite-hours" type="number" min="1" max="720" bind:value={expiresInHours} /></Field.Field><Button onclick={createInvite} disabled={busy !== null || !masterPassword || !inviteEmail.trim()}>创建并复制</Button></div></header><div class="overflow-x-auto"><Table.Root><Table.Header><Table.Row><Table.Head>邮箱</Table.Head><Table.Head>状态</Table.Head><Table.Head>到期时间</Table.Head><Table.Head>注册链接</Table.Head><Table.Head class="text-end">操作</Table.Head></Table.Row></Table.Header><Table.Body>{#each invites as invite (invite.code)}<Table.Row><Table.Cell>{invite.email}</Table.Cell><Table.Cell><Badge variant={invite.status === "active" ? "secondary" : "outline"}>{invite.status}</Badge></Table.Cell><Table.Cell>{new Date(invite.expiresAt).toLocaleString("zh-CN")}</Table.Cell><Table.Cell><Button size="sm" variant="ghost" onclick={() => navigator.clipboard.writeText(invite.inviteLink)}><Copy data-icon="inline-start" />复制</Button></Table.Cell><Table.Cell class="text-end"><Button size="sm" variant="destructive" disabled={busy !== null} onclick={() => run(`invite-${invite.code}`, (hash) => deleteAdminInviteApi(invite.code, hash))}><Trash2 data-icon="inline-start" />删除</Button></Table.Cell></Table.Row>{/each}</Table.Body></Table.Root></div></section>
		</Tabs.Content>

		<Tabs.Content value="operations" class="mt-0">
	<section class="rounded-lg border bg-card p-4"><div class="flex flex-col gap-3"><div class="flex items-center justify-between gap-3"><div><h2 class="font-semibold">移动端 Push Relay</h2><p class="text-xs text-muted-foreground">用于在后台唤醒 Bitwarden Android 和 iOS 客户端。</p></div><Badge variant={pushRelay?.enabled ? "secondary" : "outline"}>{pushRelay?.enabled ? "已开启" : "未开启"}</Badge></div>{#if pushRelay}<div class="grid gap-2 text-sm sm:grid-cols-3"><div class="rounded-md bg-muted p-3"><p class="text-xs text-muted-foreground">区域</p><p class="font-medium">{pushRelay.region}</p></div><div class="rounded-md bg-muted p-3"><p class="text-xs text-muted-foreground">Installation ID</p><p class="font-medium">{pushRelay.installationIdConfigured ? "已配置" : "缺失"}</p></div><div class="rounded-md bg-muted p-3"><p class="text-xs text-muted-foreground">Installation Key</p><p class="font-medium">{pushRelay.installationKeyConfigured ? "已配置" : "缺失"}</p></div></div>{#if pushRelay.reason === "invalid_region"}<p class="text-sm text-destructive">PUSH_REGION 必须为 US 或 EU。</p>{:else if !pushRelay.enabled}<p class="text-sm text-muted-foreground">同时配置 PUSH_INSTALLATION_ID 和 PUSH_INSTALLATION_KEY 后自动启用。</p>{/if}{:else}<p class="text-sm text-muted-foreground">正在读取 Push Relay 状态…</p>{/if}</div></section>
		</Tabs.Content>

		<Tabs.Content value="users" class="mt-0">
	<section class="min-w-0 rounded-lg border bg-card"><header class="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 class="font-semibold">用户</h2><p class="text-xs text-muted-foreground">{userSearchQuery.trim() ? `${filteredUsers.length} / ${users.length}` : users.length} 个账户</p></div><div class="flex items-center gap-2"><div class="relative min-w-0 sm:w-72"><Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" class="pl-9" bind:value={userSearchQuery} placeholder="搜索姓名、邮箱、角色或状态" aria-label="搜索用户" /></div><UserRoundCog class="hidden shrink-0 sm:block" /></div></header><div class="overflow-x-auto"><Table.Root><Table.Header><Table.Row><Table.Head>账户</Table.Head><Table.Head>角色</Table.Head><Table.Head>状态</Table.Head><Table.Head>两步验证</Table.Head><Table.Head class="text-end">操作</Table.Head></Table.Row></Table.Header><Table.Body>{#each filteredUsers as user (user.id)}<Table.Row><Table.Cell><p class="font-medium">{user.name || "未命名"}</p><p class="text-xs text-muted-foreground">{user.email}</p></Table.Cell><Table.Cell><Badge variant="outline">{user.role}</Badge></Table.Cell><Table.Cell><Badge variant={user.status === "active" ? "secondary" : "destructive"}>{user.status}</Badge></Table.Cell><Table.Cell>{user.twoFactorEnabled ? "已启用" : "未启用"}</Table.Cell><Table.Cell class="text-end"><div class="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={busy !== null || user.id === vault.profile?.id} onclick={() => run(`status-${user.id}`, (hash) => setAdminUserStatusApi(user.id, user.status === "active" ? "banned" : "active", hash))}>{user.status === "active" ? "封禁" : "启用"}</Button><Button size="sm" variant="destructive" disabled={busy !== null || user.id === vault.profile?.id} onclick={() => deleteUser = user}><Trash2 data-icon="inline-start" />删除</Button></div></Table.Cell></Table.Row>{:else}<Table.Row><Table.Cell colspan={5} class="h-24 text-center text-muted-foreground">没有匹配的用户</Table.Cell></Table.Row>{/each}</Table.Body></Table.Root></div></section>
		</Tabs.Content>
	</Tabs.Root>
</VaultPageShell>

<AlertDialog.Root open={deleteUser !== null} onOpenChange={(open) => { if (!open) deleteUser = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>永久删除用户</AlertDialog.Title><AlertDialog.Description>将永久删除 {deleteUser?.email} 及其全部保险库数据、设备和会话。此操作无法撤销。</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action class="bg-destructive text-destructive-foreground hover:bg-destructive/90" onclick={confirmDeleteUser}>确认删除</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
