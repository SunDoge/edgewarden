<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { Badge } from "$lib/components/ui/badge/index.js";
import * as Alert from "$lib/components/ui/alert/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as Table from "$lib/components/ui/table/index.js";
import {
	createAdminInviteApi,
	deleteAdminInviteApi,
	deleteAdminUserApi,
	deriveAccountPasswordHash,
	getAdminRegistrationPolicyApi,
	listAdminInvitesApi,
	listAdminUsersApi,
	setAdminUserStatusApi,
	updateAdminRegistrationPolicyApi,
} from "$lib/services/api";
import { vault } from "$lib/stores/vault.svelte";
import {
	ArrowLeft,
	Copy,
	RefreshCw,
	ShieldAlert,
	Trash2,
	UserRoundCog,
} from "@lucide/svelte";

let users = $state<any[]>([]);
let invites = $state<any[]>([]);
let masterPassword = $state("");
let expiresInHours = $state(168);
let inviteEmail = $state("");
let busy = $state<string | null>(null);
let error = $state<string | null>(null);
let signupsAllowed = $state(false);
let invitationsAllowed = $state(true);

async function refresh() {
	busy = "refresh";
	error = null;
	try {
		const [nextUsers, nextInvites, policy] = await Promise.all([
			listAdminUsersApi().then((r) => r.data),
			listAdminInvitesApi().then((r) => r.data),
			getAdminRegistrationPolicyApi(),
		]);
		users = nextUsers;
		invites = nextInvites;
		signupsAllowed = policy.signupsAllowed;
		invitationsAllowed = policy.invitationsAllowed;
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

onMount(() => {
	if (vault.profile?.role !== "admin") void goto("/vault");
	else void refresh();
});
</script>

<svelte:head><title>用户管理 - Edgewarden</title></svelte:head>

<main class="min-h-screen bg-muted/30 p-6"><div class="mx-auto flex max-w-6xl flex-col gap-6">
	<header class="flex items-center justify-between gap-3"><div class="flex items-center gap-3"><Button variant="ghost" size="icon" onclick={() => goto("/vault")} aria-label="返回保险库"><ArrowLeft /></Button><div><h1 class="text-2xl font-bold">用户与邀请</h1><p class="text-sm text-muted-foreground">敏感管理操作需要重新输入主密码。</p></div></div><Button variant="outline" onclick={refresh} disabled={busy !== null}><RefreshCw data-icon="inline-start" />刷新</Button></header>
	{#if error}<Alert.Root variant="destructive"><ShieldAlert /><Alert.Title>管理操作失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
	<Field.Group><Field.Field><Field.Label for="admin-password">当前主密码</Field.Label><Input id="admin-password" type="password" bind:value={masterPassword} autocomplete="current-password" /><Field.Description>仅用于在浏览器中派生验证摘要，不会保存。</Field.Description></Field.Field></Field.Group>

	<section class="rounded-lg border bg-card p-4"><div class="flex flex-col gap-4"><div><h2 class="font-semibold">注册策略</h2><p class="text-xs text-muted-foreground">修改后立即写入 D1，并覆盖部署变量提供的默认值。</p></div><Field.Group><Field.Field orientation="horizontal"><Field.Content><Field.Label for="public-signups">允许公开注册</Field.Label><Field.Description>无需邀请码即可创建普通账户。</Field.Description></Field.Content><Switch id="public-signups" bind:checked={signupsAllowed} disabled={busy !== null} /></Field.Field><Field.Field orientation="horizontal"><Field.Content><Field.Label for="invite-signups">允许邀请码注册</Field.Label><Field.Description>关闭后，已有邀请码也不能用于注册。</Field.Description></Field.Content><Switch id="invite-signups" bind:checked={invitationsAllowed} disabled={busy !== null} /></Field.Field></Field.Group><Button class="self-start" onclick={saveRegistrationPolicy} disabled={busy !== null || !masterPassword}>保存注册策略</Button></div></section>

	<section class="rounded-lg border bg-card"><header class="flex items-center justify-between gap-3 border-b p-4"><div><h2 class="font-semibold">用户</h2><p class="text-xs text-muted-foreground">{users.length} 个账户</p></div><UserRoundCog /></header><Table.Root><Table.Header><Table.Row><Table.Head>账户</Table.Head><Table.Head>角色</Table.Head><Table.Head>状态</Table.Head><Table.Head>两步验证</Table.Head><Table.Head class="text-end">操作</Table.Head></Table.Row></Table.Header><Table.Body>{#each users as user (user.id)}<Table.Row><Table.Cell><p class="font-medium">{user.name || "未命名"}</p><p class="text-xs text-muted-foreground">{user.email}</p></Table.Cell><Table.Cell><Badge variant="outline">{user.role}</Badge></Table.Cell><Table.Cell><Badge variant={user.status === "active" ? "secondary" : "destructive"}>{user.status}</Badge></Table.Cell><Table.Cell>{user.twoFactorEnabled ? "已启用" : "未启用"}</Table.Cell><Table.Cell class="text-end"><div class="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={busy !== null || user.id === vault.profile?.id} onclick={() => run(`status-${user.id}`, (hash) => setAdminUserStatusApi(user.id, user.status === "active" ? "banned" : "active", hash))}>{user.status === "active" ? "封禁" : "启用"}</Button><Button size="sm" variant="destructive" disabled={busy !== null || user.id === vault.profile?.id} onclick={() => confirm(`永久删除 ${user.email} 及其全部数据？`) && run(`delete-${user.id}`, (hash) => deleteAdminUserApi(user.id, hash))}><Trash2 data-icon="inline-start" />删除</Button></div></Table.Cell></Table.Row>{/each}</Table.Body></Table.Root></section>

	<section class="rounded-lg border bg-card"><header class="flex items-end justify-between gap-3 border-b p-4"><div><h2 class="font-semibold">邀请码</h2><p class="text-xs text-muted-foreground">邀请码只能由指定邮箱注册，创建后会自动复制注册链接。</p></div><div class="flex items-end gap-2"><Field.Field><Field.Label for="invite-email">受邀邮箱</Field.Label><Input id="invite-email" type="email" bind:value={inviteEmail} placeholder="name@example.com" required /></Field.Field><Field.Field><Field.Label for="invite-hours">有效小时数</Field.Label><Input id="invite-hours" type="number" min="1" max="720" bind:value={expiresInHours} class="w-28" /></Field.Field><Button onclick={createInvite} disabled={busy !== null || !masterPassword || !inviteEmail.trim()}>创建并复制</Button></div></header><Table.Root><Table.Header><Table.Row><Table.Head>邮箱</Table.Head><Table.Head>状态</Table.Head><Table.Head>到期时间</Table.Head><Table.Head>注册链接</Table.Head><Table.Head class="text-end">操作</Table.Head></Table.Row></Table.Header><Table.Body>{#each invites as invite (invite.code)}<Table.Row><Table.Cell>{invite.email}</Table.Cell><Table.Cell><Badge variant={invite.status === "active" ? "secondary" : "outline"}>{invite.status}</Badge></Table.Cell><Table.Cell>{new Date(invite.expiresAt).toLocaleString("zh-CN")}</Table.Cell><Table.Cell><Button size="sm" variant="ghost" onclick={() => navigator.clipboard.writeText(invite.inviteLink)}><Copy data-icon="inline-start" />复制</Button></Table.Cell><Table.Cell class="text-end"><Button size="sm" variant="destructive" disabled={busy !== null} onclick={() => run(`invite-${invite.code}`, (hash) => deleteAdminInviteApi(invite.code, hash))}><Trash2 data-icon="inline-start" />删除</Button></Table.Cell></Table.Row>{/each}</Table.Body></Table.Root></section>
</div></main>
