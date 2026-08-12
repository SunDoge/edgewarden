<script lang="ts">
import { CipherType } from "@edgewarden/shared";
import { Plus, ScanLine, Trash2 } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Textarea } from "$lib/components/ui/textarea/index.js";
import { scanTotpQrFile } from "$lib/services/totp-qr";
import type { VaultEditorForm } from "$lib/services/vault-editor";

interface FolderOption {
	id: string;
	name: string;
}

interface OrganizationOption {
	id: string;
	name: string;
}

interface CollectionOption {
	id: string;
	organizationId: string;
	name: string;
	readOnly?: boolean;
}

let {
	form = $bindable(),
	isCreating,
	isEditing,
	folders,
	organizations,
	collections,
	onSave,
	onDelete,
	onCancel,
}: {
	form: VaultEditorForm;
	isCreating: boolean;
	isEditing: boolean;
	folders: FolderOption[];
	organizations: OrganizationOption[];
	collections: CollectionOption[];
	onSave: () => void;
	onDelete: () => void;
	onCancel: () => void;
} = $props();

let totpQrError = $state("");
let totpQrInput = $state<HTMLInputElement | null>(null);

function changeOwner() {
	form.folderId = null;
	form.collectionIds = [];
}

function toggleCollection(collectionId: string, checked: boolean) {
	form.collectionIds = checked
		? [...new Set([...form.collectionIds, collectionId])]
		: form.collectionIds.filter((id) => id !== collectionId);
}

async function importTotpQr(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (!file) return;
	totpQrError = "";
	try {
		form.loginTotp = await scanTotpQrFile(file);
	} catch (error) {
		totpQrError = error instanceof Error ? error.message : "无法识别二维码";
	}
}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h3 class="font-bold text-lg text-slate-900 dark:text-slate-100">
			{isCreating ? "添加新条目" : "编辑条目"}
		</h3>
		<Button variant="ghost" size="sm" onclick={onCancel} class="text-slate-500 hover:text-red-500">取消</Button>
	</div>

	<hr class="border-slate-200 dark:border-slate-800" />

	<div class="space-y-4">
		{#if isCreating}
			<div class="space-y-1.5">
				<span class="text-xs font-semibold text-slate-400 font-bold">条目类型</span>
				<select bind:value={form.type} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
					<option value={CipherType.Login}>登录凭据</option>
					<option value={CipherType.SecureNote}>安全便签</option>
					<option value={CipherType.Card}>支付卡片</option>
					<option value={CipherType.Identity}>个人身份</option>
					<option value={CipherType.SshKey}>SSH 密钥</option>
					<option value={CipherType.BankAccount}>银行账户</option>
					<option value={CipherType.DriversLicense}>驾驶证</option>
					<option value={CipherType.Passport}>护照</option>
				</select>
			</div>
		{/if}

		<div class="space-y-1.5">
			<span class="text-xs font-semibold text-slate-400 font-bold">条目名称</span>
			<Input bind:value={form.name} placeholder="例如: 我的个人邮箱" />
		</div>

		<div class="space-y-1.5">
			<span class="text-xs font-semibold text-slate-400 font-bold">所有者</span>
			<select bind:value={form.organizationId} disabled={isEditing} onchange={changeOwner} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60">
				<option value={null}>我的保险库</option>
				{#each organizations as organization}<option value={organization.id}>{organization.name}</option>{/each}
			</select>
		</div>

		{#if form.organizationId}
			<div class="space-y-2">
				<span class="text-xs font-semibold text-slate-400 font-bold">集合</span>
				{#each collections.filter((collection) => collection.organizationId === form.organizationId) as collection}
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={form.collectionIds.includes(collection.id)} disabled={Boolean(collection.readOnly)} onchange={(event) => toggleCollection(collection.id, event.currentTarget.checked)} />
						<span>{collection.name}{collection.readOnly ? "（只读）" : ""}</span>
					</label>
				{/each}
			</div>
		{:else}
			<div class="space-y-1.5">
				<span class="text-xs font-semibold text-slate-400 font-bold">文件夹</span>
				<select bind:value={form.folderId} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm">
					<option value={null}>无</option>
					{#each folders as folder}<option value={folder.id}>{folder.name}</option>{/each}
				</select>
			</div>
		{/if}

		<div class="flex items-center gap-2 py-1">
			<input type="checkbox" id="favorite" bind:checked={form.favorite} class="rounded border-slate-300 text-primary focus:ring-primary size-4" />
			<label for="favorite" class="text-sm font-semibold text-slate-650 cursor-pointer">设为收藏</label>
		</div>

		{#if form.type === CipherType.Login}
			<div class="space-y-4 border-t border-slate-200 dark:border-slate-850 pt-4">
				<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400 font-bold">用户名</span><Input bind:value={form.loginUsername} placeholder="用户名" /></div>
				<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400 font-bold">密码</span><Input type="password" bind:value={form.loginPassword} placeholder="密码" /></div>
				<div class="space-y-2">
					<div class="flex items-center justify-between"><span class="text-xs font-semibold text-slate-400 font-bold">网页链接</span><Button type="button" size="xs" variant="ghost" onclick={() => form.loginUris = [...form.loginUris, { uri: "", match: null }]}><Plus />添加</Button></div>
					{#each form.loginUris as uri, index}
						<div class="flex gap-2"><Input bind:value={uri.uri} placeholder="https://example.com" /><select bind:value={uri.match} aria-label="匹配方式" class="w-28 rounded-md border bg-background px-2 text-xs"><option value={null}>默认</option><option value={0}>根域</option><option value={1}>主机</option><option value={3}>完全匹配</option><option value={2}>前缀</option><option value={4}>正则</option><option value={5}>从不</option></select>{#if form.loginUris.length > 1}<Button type="button" variant="ghost" size="icon-sm" onclick={() => form.loginUris = form.loginUris.filter((_, itemIndex) => itemIndex !== index)} aria-label="删除网址"><Trash2 /></Button>{/if}</div>
					{/each}
				</div>
				<div class="space-y-1.5">
					<div class="flex items-center justify-between"><span class="text-xs font-semibold text-slate-400 font-bold">TOTP 密钥、otpauth 或 steam URI</span><Button type="button" size="xs" variant="ghost" onclick={() => totpQrInput?.click()}><ScanLine />扫描二维码</Button></div>
					<Input bind:value={form.loginTotp} autocomplete="off" />
					<input bind:this={totpQrInput} type="file" accept="image/*" class="hidden" onchange={importTotpQr} />
					{#if totpQrError}<p class="text-xs text-destructive" role="alert">{totpQrError}</p>{/if}
				</div>
			</div>
		{/if}

		{#if form.type === CipherType.Card}
			<div class="space-y-4 border-t border-slate-200 dark:border-slate-850 pt-4">
				<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400 font-bold">持卡人姓名</span><Input bind:value={form.cardholderName} placeholder="持卡人" /></div>
				<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400 font-bold">卡号</span><Input bind:value={form.cardNumber} placeholder="卡号" /></div>
			</div>
		{/if}

		{#if form.type >= CipherType.SshKey}
			<div class="space-y-1.5 border-t pt-4"><span class="text-xs font-semibold text-slate-400">类型数据（JSON）</span><Textarea bind:value={form.extraData} rows={10} class="font-mono text-xs" /><p class="text-xs text-muted-foreground">对象中的所有字符串都会在发送前逐字段加密。</p></div>
		{/if}

		<div class="space-y-3 border-t pt-4">
			<div class="flex items-center justify-between"><span class="text-xs font-semibold text-slate-400">自定义字段</span><Button type="button" size="xs" variant="ghost" onclick={() => form.customFields = [...form.customFields, { name: "", value: "", type: 0 }]}><Plus />添加</Button></div>
			{#each form.customFields as field, index}
				<div class="grid grid-cols-[1fr_1fr_auto] gap-2"><Input bind:value={field.name} placeholder="字段名" /><Input bind:value={field.value} type={field.type === 1 ? "password" : "text"} placeholder="字段值" /><Button type="button" variant="ghost" size="icon-sm" onclick={() => form.customFields = form.customFields.filter((_, itemIndex) => itemIndex !== index)} aria-label="删除字段"><Trash2 /></Button><select bind:value={field.type} aria-label="字段类型" class="col-span-2 rounded-md border bg-background px-2 py-1 text-xs"><option value={0}>文本</option><option value={1}>隐藏</option><option value={2}>布尔</option></select></div>
			{/each}
		</div>

		{#if form.type === CipherType.Identity}
			<div class="space-y-4 border-t border-slate-200 dark:border-slate-850 pt-4">
				<div class="grid grid-cols-2 gap-2"><div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400 font-bold">姓</span><Input bind:value={form.lastName} placeholder="姓" /></div><div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400 font-bold">名</span><Input bind:value={form.firstName} placeholder="名" /></div></div>
				<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400 font-bold">证件号码</span><Input bind:value={form.identityNumber} placeholder="身份证/护照等号码" /></div>
			</div>
		{/if}

		<div class="space-y-1.5 border-t border-slate-200 dark:border-slate-850 pt-4"><span class="text-xs font-semibold text-slate-400 font-bold">便签 / 备注</span><textarea bind:value={form.notes} rows="4" placeholder="便签内容..." class="w-full p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-y"></textarea></div>
	</div>

	<div class="flex gap-2 pt-2">
		<Button onclick={onSave} class="flex-1 bg-primary text-primary-foreground font-semibold">保存</Button>
		{#if isEditing}<Button onclick={onDelete} variant="ghost" class="text-red-500 hover:text-red-650 hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-200 dark:border-red-950">删除</Button>{/if}
	</div>
</div>
