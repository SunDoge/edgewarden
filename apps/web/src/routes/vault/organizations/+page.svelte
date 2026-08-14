<script lang="ts">
import { onMount } from "svelte";
import { match } from "ts-pattern";
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
import * as Alert from "$lib/components/ui/alert/index.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import * as Select from "$lib/components/ui/select/index.js";
import * as Table from "$lib/components/ui/table/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
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
let renameTarget = $state<{
	kind: "organization" | "collection";
	id: string;
} | null>(null);
let renameName = $state("");
let removeTarget = $state<{
	kind: "member" | "collection";
	id: string;
	name: string;
} | null>(null);

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

function openRenameOrganization() {
	if (!selected) return;
	renameTarget = { kind: "organization", id: selected.id };
	renameName = selected.name;
}

function openRenameCollection(collection: any) {
	renameTarget = { kind: "collection", id: collection.id };
	renameName = collection.name;
}

async function saveRename() {
	if (!selected || !renameTarget || !renameName.trim()) return;
	const target = renameTarget;
	const name = renameName.trim();
	try {
		await match(target)
			.with({ kind: "organization" }, () =>
				updateOrganizationApi(selected.id, name),
			)
			.with({ kind: "collection" }, async ({ id }) => {
				const key = getOrganizationKey(selected.id);
				if (!key) throw new Error("组织密钥不可用");
				await updateOrganizationCollectionApi(
					selected.id,
					id,
					await encryptStr(name, key.encKey, key.macKey),
				);
			})
			.exhaustive();
		renameTarget = null;
		await syncVaultData();
		if (target.kind === "organization") await load();
		else
			collections = vault.collections.filter(
				(item) => item.organizationId === selected.id,
			);
	} catch (value) {
		error = value instanceof Error ? value.message : "重命名失败";
	}
}

async function removeMember(member: any) {
	if (!selected) return;
	await removeOrganizationMemberApi(selected.id, member.id);
	members = members.filter((item) => item.id !== member.id);
}

async function removeCollection(collection: any) {
	if (!selected) return;
	await deleteOrganizationCollectionApi(selected.id, collection.id);
	await syncVaultData();
	collections = vault.collections.filter(
		(item) => item.organizationId === selected.id,
	);
}

async function confirmRemove() {
	if (!removeTarget) return;
	const target = removeTarget;
	removeTarget = null;
	await match(target)
		.with({ kind: "member" }, ({ id, name }) =>
			removeMember({ id, email: name }),
		)
		.with({ kind: "collection" }, ({ id, name }) =>
			removeCollection({ id, name }),
		)
		.exhaustive();
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
	<header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div class="flex min-w-0 items-start gap-2 sm:items-center sm:gap-3"><Button variant="ghost" size="icon" class="shrink-0" onclick={() => goto("/vault")} aria-label="返回"><ArrowLeft data-icon /></Button><div class="min-w-0"><h1 class="text-xl font-semibold sm:text-2xl">组织共享</h1><p class="text-sm text-muted-foreground">组织密钥只在成员设备上解封，服务器无法读取共享条目。</p></div></div><Button class="self-end sm:self-auto" onclick={() => createOpen = true}><Plus data-icon="inline-start" />创建组织</Button></header>
	{#if error}<Alert.Root variant="destructive"><Alert.Title>操作失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
	{#if loading}<div class="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Spinner />正在加载…</div>{:else}
		<div class="grid gap-6 md:grid-cols-[16rem_1fr]">
			<Card.Root><Card.Header><Card.Title>组织</Card.Title></Card.Header><Card.Content class="space-y-2">{#each organizations as organization (organization.id)}<Button class="w-full justify-start" variant={selected?.id === organization.id ? "secondary" : "ghost"} onclick={async () => { selected = organization; await loadSelected(); }}><Building2 />{organization.name}</Button>{:else}<p class="text-sm text-muted-foreground">尚未创建或加入组织。</p>{/each}</Card.Content></Card.Root>
			{#if selected}<div class="flex flex-col gap-6"><Card.Root><Card.Header><div class="flex items-center justify-between"><div><Card.Title>{selected.name}</Card.Title><Card.Description>角色：{selected.role}</Card.Description></div>{#if selected.role === "owner"}<Button variant="ghost" size="icon-sm" onclick={openRenameOrganization} aria-label="重命名组织"><Pencil data-icon /></Button>{/if}</div></Card.Header><Card.Content><div class="grid gap-3 sm:grid-cols-[1fr_auto]"><Input bind:value={collectionName} placeholder="新集合名称" /><Button onclick={addCollection} disabled={!collectionName.trim() || busy === "collection"}>添加集合</Button></div><div class="mt-4 flex flex-col gap-2">{#each vault.collections.filter((item) => item.organizationId === selected.id) as collection (collection.id)}<div class="flex items-center justify-between rounded-md border p-3"><span>{collection.name}</span>{#if ["owner", "admin", "manager"].includes(selected.role)}<div class="flex gap-1"><Button variant="ghost" size="icon-sm" onclick={() => openRenameCollection(collection)} aria-label="重命名集合"><Pencil data-icon /></Button><Button variant="ghost" size="icon-sm" onclick={() => removeTarget = { kind: "collection", id: collection.id, name: collection.name }} aria-label="删除集合"><Trash2 data-icon /></Button></div>{/if}</div>{/each}</div></Card.Content></Card.Root>
			{#if ["owner", "admin", "manager"].includes(selected.role)}
				<Card.Root><Card.Header><Card.Title>成员</Card.Title></Card.Header><Card.Content class="space-y-4">
					<div class="grid gap-3 md:grid-cols-[1fr_10rem_auto]"><Input type="email" bind:value={inviteEmail} placeholder="已注册用户邮箱" /><Select.Root type="single" bind:value={inviteRole}><Select.Trigger>{inviteRole}</Select.Trigger><Select.Content><Select.Group><Select.Item value="member">member</Select.Item>{#if selected.role !== "manager"}<Select.Item value="manager">manager</Select.Item>{/if}{#if selected.role === "owner"}<Select.Item value="admin">admin</Select.Item>{/if}</Select.Group></Select.Content></Select.Root><Button onclick={inviteMember} disabled={!inviteEmail.trim() || busy === "invite"}><UserPlus data-icon="inline-start" />添加</Button></div>
					<Field.Field orientation="horizontal"><Checkbox id="invite-access-all" bind:checked={inviteAccessAll} /><Field.Label for="invite-access-all">访问全部集合</Field.Label></Field.Field>
					{#if !inviteAccessAll}<Field.FieldSet><Field.FieldLegend>允许访问的集合</Field.FieldLegend><Field.FieldGroup class="grid sm:grid-cols-2">{#each vault.collections.filter((item) => item.organizationId === selected.id) as collection}<Field.Field orientation="horizontal"><Checkbox id={`invite-${collection.id}`} checked={inviteCollectionIds.includes(collection.id)} onCheckedChange={(checked) => inviteCollectionIds = checked ? [...new Set([...inviteCollectionIds, collection.id])] : inviteCollectionIds.filter((id) => id !== collection.id)} /><Field.Label for={`invite-${collection.id}`}>{collection.name}</Field.Label></Field.Field>{/each}</Field.FieldGroup></Field.FieldSet>{/if}
					<div class="overflow-x-auto"><Table.Root><Table.Header><Table.Row><Table.Head>邮箱</Table.Head><Table.Head>角色</Table.Head><Table.Head>范围</Table.Head><Table.Head class="text-right">操作</Table.Head></Table.Row></Table.Header><Table.Body>{#each members as member (member.id)}<Table.Row><Table.Cell>{member.email}</Table.Cell><Table.Cell>{member.role}</Table.Cell><Table.Cell>{member.accessAll ? "全部" : `${member.collections?.length ?? 0} 个集合`}</Table.Cell><Table.Cell class="text-right">{#if member.role !== "owner"}<Button variant="ghost" size="icon-sm" onclick={() => editMember(member)} aria-label="编辑成员"><Pencil data-icon /></Button><Button variant="ghost" size="icon-sm" onclick={() => removeTarget = { kind: "member", id: member.id, name: member.email }} aria-label="移除成员"><Trash2 data-icon /></Button>{/if}</Table.Cell></Table.Row>{/each}</Table.Body></Table.Root></div>
				</Card.Content></Card.Root>
			{/if}
			{#if selected.role === "owner"}<Card.Root class="border-destructive/30"><Card.Header><Card.Title>删除组织</Card.Title><Card.Description>此操作会永久删除组织集合、共享条目和成员关系。</Card.Description></Card.Header><Card.Content class="flex flex-col gap-2 sm:flex-row"><Input type="password" bind:value={deletePassword} autocomplete="current-password" placeholder="输入主密码确认" /><Button variant="destructive" onclick={removeOrganization} disabled={!deletePassword || busy === "delete-org"}>永久删除</Button></Card.Content></Card.Root>{/if}</div>{/if}
		</div>
	{/if}
</main>

<Dialog.Root bind:open={createOpen}><Dialog.Content><Dialog.Header><Dialog.Title>创建组织</Dialog.Title><Dialog.Description>浏览器会生成独立组织密钥和 RSA 密钥对。</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label for="organization-name">组织名称</Field.Label><Input id="organization-name" bind:value={organizationName} /></Field.Field><Field.Field><Field.Label for="collection-name">初始集合</Field.Label><Input id="collection-name" bind:value={initialCollectionName} /></Field.Field></Field.Group><Dialog.Footer><Button variant="outline" onclick={() => createOpen = false}>取消</Button><Button onclick={createOrganization} disabled={!organizationName.trim() || !initialCollectionName.trim() || busy === "create"}>创建</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root open={Boolean(editingMember)} onOpenChange={(open) => { if (!open) editingMember = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>成员权限</Dialog.Title><Dialog.Description>{editingMember?.email}</Dialog.Description></Dialog.Header><Field.Group><Field.Field><Field.Label>角色</Field.Label><Select.Root type="single" bind:value={memberRole}><Select.Trigger>{memberRole}</Select.Trigger><Select.Content><Select.Group><Select.Item value="member">member</Select.Item>{#if selected?.role !== "manager"}<Select.Item value="manager">manager</Select.Item>{/if}{#if selected?.role === "owner"}<Select.Item value="admin">admin</Select.Item>{/if}</Select.Group></Select.Content></Select.Root></Field.Field><Field.Field orientation="horizontal"><Checkbox id="member-access-all" bind:checked={memberAccessAll} /><Field.Label for="member-access-all">访问全部集合</Field.Label></Field.Field>{#if !memberAccessAll}<Field.FieldSet><Field.FieldLegend>集合权限</Field.FieldLegend><Field.FieldGroup>{#each vault.collections.filter((item) => item.organizationId === selected?.id) as collection}{@const access = memberCollectionAccess[collection.id]}<Field.FieldSet class="rounded-md border p-3"><Field.Field orientation="horizontal"><Checkbox id={`member-${collection.id}`} checked={access?.selected} onCheckedChange={(checked) => memberCollectionAccess = { ...memberCollectionAccess, [collection.id]: { ...(access ?? { readOnly: false, hidePasswords: false }), selected: checked } }} /><Field.Label for={`member-${collection.id}`}>{collection.name}</Field.Label></Field.Field>{#if access?.selected}<Field.FieldGroup class="mt-2 pl-6"><Field.Field orientation="horizontal"><Checkbox id={`readonly-${collection.id}`} checked={access.readOnly} onCheckedChange={(checked) => memberCollectionAccess = { ...memberCollectionAccess, [collection.id]: { ...access, readOnly: checked } }} /><Field.Label for={`readonly-${collection.id}`}>只读</Field.Label></Field.Field><Field.Field orientation="horizontal"><Checkbox id={`hide-${collection.id}`} checked={access.hidePasswords} onCheckedChange={(checked) => memberCollectionAccess = { ...memberCollectionAccess, [collection.id]: { ...access, hidePasswords: checked } }} /><Field.Label for={`hide-${collection.id}`}>隐藏密码</Field.Label></Field.Field></Field.FieldGroup>{/if}</Field.FieldSet>{/each}</Field.FieldGroup></Field.FieldSet>{/if}</Field.Group><Dialog.Footer><Button variant="outline" onclick={() => editingMember = null}>取消</Button><Button onclick={saveMember} disabled={busy === "member"}>保存</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<Dialog.Root open={renameTarget !== null} onOpenChange={(open) => { if (!open) renameTarget = null; }}><Dialog.Content><Dialog.Header><Dialog.Title>{renameTarget?.kind === "organization" ? "重命名组织" : "重命名集合"}</Dialog.Title><Dialog.Description>输入一个便于成员识别的新名称。</Dialog.Description></Dialog.Header><Field.Field><Field.Label for="rename-name">名称</Field.Label><Input id="rename-name" bind:value={renameName} /></Field.Field><Dialog.Footer><Button variant="outline" onclick={() => renameTarget = null}>取消</Button><Button onclick={saveRename} disabled={!renameName.trim()}>保存</Button></Dialog.Footer></Dialog.Content></Dialog.Root>

<AlertDialog.Root open={removeTarget !== null} onOpenChange={(open) => { if (!open) removeTarget = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{removeTarget?.kind === "member" ? "移除组织成员" : "删除集合"}</AlertDialog.Title><AlertDialog.Description>{removeTarget?.kind === "member" ? `确定要移除成员 ${removeTarget.name}？` : `确定要删除集合 ${removeTarget?.name}？集合内条目必须先移动或删除。`}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>取消</AlertDialog.Cancel><AlertDialog.Action class="bg-destructive text-destructive-foreground hover:bg-destructive/90" onclick={confirmRemove}>确认</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
