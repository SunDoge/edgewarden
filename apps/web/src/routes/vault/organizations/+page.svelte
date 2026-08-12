<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import {
	createOrganizationApi,
	createOrganizationCollectionApi,
	deleteOrganizationApi,
	deleteOrganizationCollectionApi,
	deriveAccountPasswordHash,
	getOrganizationInviteeApi,
	inviteOrganizationMemberApi,
	listOrganizationCollectionsApi,
	listOrganizationMembersApi,
	listOrganizationsApi,
	removeOrganizationMemberApi,
	updateOrganizationApi,
	updateOrganizationCollectionApi,
	updateOrganizationMemberApi,
} from "$lib/services/api";
import {
	createOrganizationMaterials,
	wrapOrganizationKey,
} from "$lib/services/organization-crypto";
import { encryptStr } from "$lib/services/crypto";
import {
	getOrganizationKey,
	syncVaultData,
	vault,
} from "$lib/stores/vault.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import * as Select from "$lib/components/ui/select/index.js";
import * as Table from "$lib/components/ui/table/index.js";
import {
	ArrowLeft,
	Building2,
	Pencil,
	Plus,
	Trash2,
	UserPlus,
} from "@lucide/svelte";

let organizations = $state<any[]>([]);
let selected = $state<any>(null);
let members = $state<any[]>([]);
let collections = $state<any[]>([]);
let loading = $state(true);
let busy = $state("");
let error = $state("");
let createOpen = $state(false);
let organizationName = $state("");
let initialCollectionName = $state("默认集合");
let inviteEmail = $state("");
let inviteRole = $state<"admin" | "manager" | "member">("member");
let inviteAccessAll = $state(true);
let inviteCollectionIds = $state<string[]>([]);
let editingMember = $state<any>(null);
let memberRole = $state<"admin" | "manager" | "member">("member");
let memberAccessAll = $state(true);
let memberCollectionAccess = $state<
	Record<
		string,
		{ selected: boolean; readOnly: boolean; hidePasswords: boolean }
	>
>({});
let collectionName = $state("");
let deletePassword = $state("");

async function load() {
	loading = true;
	try {
		organizations = (await listOrganizationsApi()).data ?? [];
		if (selected)
			selected =
				organizations.find((item) => item.id === selected.id) ??
				organizations[0] ??
				null;
		else selected = organizations[0] ?? null;
		await loadSelected();
	} catch (value) {
		error = value instanceof Error ? value.message : "加载组织失败";
	} finally {
		loading = false;
	}
}

async function loadSelected() {
	if (!selected) {
		members = [];
		collections = [];
		return;
	}
	const tasks: Promise<any>[] = [listOrganizationCollectionsApi(selected.id)];
	if (["owner", "admin", "manager"].includes(selected.role))
		tasks.push(listOrganizationMembersApi(selected.id));
	const results = await Promise.all(tasks);
	collections = results[0].data ?? [];
	members = results[1]?.data ?? [];
}

onMount(async () => {
	if (!vault.isUnlocked) return goto("/vault/unlock");
	await load();
});

async function createOrganization() {
	if (
		!vault.profile?.publicKey ||
		!organizationName.trim() ||
		!initialCollectionName.trim()
	)
		return;
	busy = "create";
	try {
		const materials = await createOrganizationMaterials(
			vault.profile.publicKey,
			initialCollectionName.trim(),
		);
		await createOrganizationApi({
			name: organizationName.trim(),
			collectionName: materials.encryptedCollectionName,
			key: materials.wrappedMemberKey,
			publicKey: materials.publicKey,
			encryptedPrivateKey: materials.encryptedPrivateKey,
		});
		createOpen = false;
		organizationName = "";
		await syncVaultData();
		await load();
	} catch (value) {
		error = value instanceof Error ? value.message : "创建组织失败";
	} finally {
		busy = "";
	}
}

async function inviteMember() {
	if (!selected || !inviteEmail.trim()) return;
	const organizationKey = getOrganizationKey(selected.id);
	if (!organizationKey) {
		error = "组织密钥不可用，请重新同步并解锁";
		return;
	}
	busy = "invite";
	try {
		const invitee = await getOrganizationInviteeApi(
			selected.id,
			inviteEmail.trim(),
		);
		if (!inviteAccessAll && !inviteCollectionIds.length)
			throw new Error("受限成员至少需要选择一个集合");
		await inviteOrganizationMemberApi(selected.id, {
			email: invitee.email,
			role: inviteRole,
			accessAll: inviteAccessAll,
			collections: inviteAccessAll
				? []
				: inviteCollectionIds.map((id) => ({
						id,
						readOnly: false,
						hidePasswords: false,
					})),
			key: await wrapOrganizationKey(organizationKey, invitee.publicKey),
		});
		inviteEmail = "";
		inviteAccessAll = true;
		inviteCollectionIds = [];
		members = (await listOrganizationMembersApi(selected.id)).data ?? [];
	} catch (value) {
		error = value instanceof Error ? value.message : "添加成员失败";
	} finally {
		busy = "";
	}
}

function editMember(member: any) {
	editingMember = member;
	memberRole = member.role;
	memberAccessAll = Boolean(member.accessAll);
	memberCollectionAccess = Object.fromEntries(
		vault.collections
			.filter((item) => item.organizationId === selected?.id)
			.map((collection) => {
				const current = (member.collections ?? []).find(
					(item: any) => item.id === collection.id,
				);
				return [
					collection.id,
					{
						selected: Boolean(current),
						readOnly: Boolean(current?.readOnly),
						hidePasswords: Boolean(current?.hidePasswords),
					},
				];
			}),
	);
}

async function saveMember() {
	if (!selected || !editingMember) return;
	const selectedCollections = Object.entries(memberCollectionAccess)
		.filter(([, access]) => access.selected)
		.map(([id, access]) => ({
			id,
			readOnly: access.readOnly,
			hidePasswords: access.hidePasswords,
		}));
	if (!memberAccessAll && !selectedCollections.length) {
		error = "受限成员至少需要选择一个集合";
		return;
	}
	busy = "member";
	try {
		await updateOrganizationMemberApi(selected.id, editingMember.id, {
			role: memberRole,
			accessAll: memberAccessAll,
			collections: memberAccessAll ? [] : selectedCollections,
		});
		editingMember = null;
		members = (await listOrganizationMembersApi(selected.id)).data ?? [];
		await syncVaultData();
	} catch (value) {
		error = value instanceof Error ? value.message : "更新成员失败";
	} finally {
		busy = "";
	}
}

async function addCollection() {
	if (!selected || !collectionName.trim()) return;
	const key = getOrganizationKey(selected.id);
	if (!key) return;
	busy = "collection";
	try {
		await createOrganizationCollectionApi(
			selected.id,
			await encryptStr(collectionName.trim(), key.encKey, key.macKey),
		);
		collectionName = "";
		await syncVaultData();
		collections = vault.collections.filter(
			(item) => item.organizationId === selected.id,
		);
	} catch (value) {
		error = value instanceof Error ? value.message : "创建集合失败";
	} finally {
		busy = "";
	}
}

async function renameOrganization() {
	if (!selected) return;
	const name = prompt("新的组织名称", selected.name)?.trim();
	if (!name) return;
	try {
		await updateOrganizationApi(selected.id, name);
		await syncVaultData();
		await load();
	} catch (value) {
		error = value instanceof Error ? value.message : "重命名组织失败";
	}
}

async function renameCollection(collection: any) {
	if (!selected) return;
	const name = prompt("新的集合名称", collection.name)?.trim();
	const key = getOrganizationKey(selected.id);
	if (!name || !key) return;
	try {
		await updateOrganizationCollectionApi(
			selected.id,
			collection.id,
			await encryptStr(name, key.encKey, key.macKey),
		);
		await syncVaultData();
		collections = vault.collections.filter(
			(item) => item.organizationId === selected.id,
		);
	} catch (value) {
		error = value instanceof Error ? value.message : "重命名集合失败";
	}
}

async function removeMember(member: any) {
	if (!selected || !confirm(`移除成员 ${member.email}？`)) return;
	await removeOrganizationMemberApi(selected.id, member.id);
	members = members.filter((item) => item.id !== member.id);
}

async function removeCollection(collection: any) {
	if (
		!selected ||
		!confirm(`删除集合 ${collection.name}？集合内条目必须先移动或删除。`)
	)
		return;
	await deleteOrganizationCollectionApi(selected.id, collection.id);
	await syncVaultData();
	collections = vault.collections.filter(
		(item) => item.organizationId === selected.id,
	);
}

async function removeOrganization() {
	if (!selected || !deletePassword || !vault.profile) return;
	busy = "delete-org";
	try {
		await deleteOrganizationApi(
			selected.id,
			await deriveAccountPasswordHash(vault.profile.email, deletePassword),
		);
		deletePassword = "";
		selected = null;
		await syncVaultData();
		await load();
	} catch (value) {
		error = value instanceof Error ? value.message : "删除组织失败";
	} finally {
		busy = "";
	}
}
</script>

<svelte:head><title>组织共享 · Edgewarden</title></svelte:head>

<main class="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-8">
	<header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div class="flex min-w-0 items-start gap-2 sm:items-center sm:gap-3"><Button variant="ghost" size="icon" class="shrink-0" onclick={() => goto("/vault")} aria-label="返回"><ArrowLeft /></Button><div class="min-w-0"><h1 class="text-xl font-semibold sm:text-2xl">组织共享</h1><p class="text-sm text-muted-foreground">组织密钥只在成员设备上解封，服务器无法读取共享条目。</p></div></div><Button class="self-end sm:self-auto" onclick={() => createOpen = true}><Plus />创建组织</Button></header>
	{#if error}<div role="alert" class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if loading}<p class="py-12 text-muted-foreground">正在加载…</p>{:else}
		<div class="grid gap-6 md:grid-cols-[16rem_1fr]">
			<Card.Root><Card.Header><Card.Title>组织</Card.Title></Card.Header><Card.Content class="space-y-2">{#each organizations as organization (organization.id)}<Button class="w-full justify-start" variant={selected?.id === organization.id ? "secondary" : "ghost"} onclick={async () => { selected = organization; await loadSelected(); }}><Building2 />{organization.name}</Button>{:else}<p class="text-sm text-muted-foreground">尚未创建或加入组织。</p>{/each}</Card.Content></Card.Root>
			{#if selected}<div class="space-y-6"><Card.Root><Card.Header><div class="flex items-center justify-between"><div><Card.Title>{selected.name}</Card.Title><Card.Description>角色：{selected.role}</Card.Description></div>{#if selected.role === "owner"}<Button variant="ghost" size="icon-sm" onclick={renameOrganization} aria-label="重命名组织"><Pencil /></Button>{/if}</div></Card.Header><Card.Content><div class="grid gap-3 sm:grid-cols-[1fr_auto]"><Input bind:value={collectionName} placeholder="新集合名称" /><Button onclick={addCollection} disabled={!collectionName.trim() || busy === "collection"}>添加集合</Button></div><div class="mt-4 space-y-2">{#each vault.collections.filter((item) => item.organizationId === selected.id) as collection (collection.id)}<div class="flex items-center justify-between rounded-md border p-3"><span>{collection.name}</span>{#if ["owner", "admin", "manager"].includes(selected.role)}<div class="flex gap-1"><Button variant="ghost" size="icon-sm" onclick={() => renameCollection(collection)} aria-label="重命名集合"><Pencil /></Button><Button variant="ghost" size="icon-sm" onclick={() => removeCollection(collection)} aria-label="删除集合"><Trash2 /></Button></div>{/if}</div>{/each}</div></Card.Content></Card.Root>
			{#if ["owner", "admin", "manager"].includes(selected.role)}
				<Card.Root><Card.Header><Card.Title>成员</Card.Title></Card.Header><Card.Content class="space-y-4">
					<div class="grid gap-3 md:grid-cols-[1fr_10rem_auto]"><Input type="email" bind:value={inviteEmail} placeholder="已注册用户邮箱" /><Select.Root type="single" bind:value={inviteRole}><Select.Trigger>{inviteRole}</Select.Trigger><Select.Content><Select.Item value="member">member</Select.Item>{#if selected.role !== "manager"}<Select.Item value="manager">manager</Select.Item>{/if}{#if selected.role === "owner"}<Select.Item value="admin">admin</Select.Item>{/if}</Select.Content></Select.Root><Button onclick={inviteMember} disabled={!inviteEmail.trim() || busy === "invite"}><UserPlus />添加</Button></div>
					<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={inviteAccessAll} />访问全部集合</label>
					{#if !inviteAccessAll}<div class="grid gap-2 sm:grid-cols-2">{#each vault.collections.filter((item) => item.organizationId === selected.id) as collection}<label class="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={inviteCollectionIds.includes(collection.id)} onchange={(event) => inviteCollectionIds = event.currentTarget.checked ? [...new Set([...inviteCollectionIds, collection.id])] : inviteCollectionIds.filter((id) => id !== collection.id)} />{collection.name}</label>{/each}</div>{/if}
					<div class="overflow-x-auto"><Table.Root><Table.Header><Table.Row><Table.Head>邮箱</Table.Head><Table.Head>角色</Table.Head><Table.Head>范围</Table.Head><Table.Head class="text-right">操作</Table.Head></Table.Row></Table.Header><Table.Body>{#each members as member (member.id)}<Table.Row><Table.Cell>{member.email}</Table.Cell><Table.Cell>{member.role}</Table.Cell><Table.Cell>{member.accessAll ? "全部" : `${member.collections?.length ?? 0} 个集合`}</Table.Cell><Table.Cell class="text-right">{#if member.role !== "owner"}<Button variant="ghost" size="icon-sm" onclick={() => editMember(member)} aria-label="编辑成员"><Pencil /></Button><Button variant="ghost" size="icon-sm" onclick={() => removeMember(member)} aria-label="移除成员"><Trash2 /></Button>{/if}</Table.Cell></Table.Row>{/each}</Table.Body></Table.Root></div>
				</Card.Content></Card.Root>
			{/if}
			{#if selected.role === "owner"}<Card.Root class="border-destructive/30"><Card.Header><Card.Title>删除组织</Card.Title><Card.Description>此操作会永久删除组织集合、共享条目和成员关系。</Card.Description></Card.Header><Card.Content class="flex flex-col gap-2 sm:flex-row"><Input type="password" bind:value={deletePassword} autocomplete="current-password" placeholder="输入主密码确认" /><Button variant="destructive" onclick={removeOrganization} disabled={!deletePassword || busy === "delete-org"}>永久删除</Button></Card.Content></Card.Root>{/if}</div>{/if}
		</div>
	{/if}
</main>

<Dialog.Root bind:open={createOpen}><Dialog.Content><Dialog.Header><Dialog.Title>创建组织</Dialog.Title><Dialog.Description>浏览器会生成独立组织密钥和 RSA 密钥对。</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label for="organization-name">组织名称</Field.Label><Input id="organization-name" bind:value={organizationName} /></Field.Field><Field.Field><Field.Label for="collection-name">初始集合</Field.Label><Input id="collection-name" bind:value={initialCollectionName} /></Field.Field></Field.Group><Dialog.Footer><Button variant="outline" onclick={() => createOpen = false}>取消</Button><Button onclick={createOrganization} disabled={!organizationName.trim() || !initialCollectionName.trim() || busy === "create"}>创建</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root open={Boolean(editingMember)} onOpenChange={(open) => { if (!open) editingMember = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>成员权限</Dialog.Title><Dialog.Description>{editingMember?.email}</Dialog.Description></Dialog.Header><div class="space-y-4"><Select.Root type="single" bind:value={memberRole}><Select.Trigger>{memberRole}</Select.Trigger><Select.Content><Select.Item value="member">member</Select.Item>{#if selected?.role !== "manager"}<Select.Item value="manager">manager</Select.Item>{/if}{#if selected?.role === "owner"}<Select.Item value="admin">admin</Select.Item>{/if}</Select.Content></Select.Root><label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={memberAccessAll} />访问全部集合</label>{#if !memberAccessAll}<div class="space-y-2">{#each vault.collections.filter((item) => item.organizationId === selected?.id) as collection}{@const access = memberCollectionAccess[collection.id]}<div class="rounded-md border p-3"><label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={access?.selected} onchange={(event) => memberCollectionAccess = { ...memberCollectionAccess, [collection.id]: { ...(access ?? { readOnly: false, hidePasswords: false }), selected: event.currentTarget.checked } }} />{collection.name}</label>{#if access?.selected}<div class="mt-2 flex gap-4 pl-6 text-xs text-muted-foreground"><label class="flex items-center gap-1"><input type="checkbox" checked={access.readOnly} onchange={(event) => memberCollectionAccess = { ...memberCollectionAccess, [collection.id]: { ...access, readOnly: event.currentTarget.checked } }} />只读</label><label class="flex items-center gap-1"><input type="checkbox" checked={access.hidePasswords} onchange={(event) => memberCollectionAccess = { ...memberCollectionAccess, [collection.id]: { ...access, hidePasswords: event.currentTarget.checked } }} />隐藏密码</label></div>{/if}</div>{/each}</div>{/if}</div><Dialog.Footer><Button variant="outline" onclick={() => editingMember = null}>取消</Button><Button onclick={saveMember} disabled={busy === "member"}>保存</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
