<script lang="ts">
import { CipherType } from "@edgewarden/shared";
import { Plus, ScanLine, Trash2 } from "@lucide/svelte";
import { match } from "ts-pattern";
import { Button } from "$lib/components/ui/button/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Select from "$lib/components/ui/select/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
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

function cipherTypeLabel(type: number): string {
  return match(type)
    .with(CipherType.Login, () => "登录凭据")
    .with(CipherType.SecureNote, () => "安全便签")
    .with(CipherType.Card, () => "支付卡片")
    .with(CipherType.Identity, () => "个人身份")
    .with(CipherType.SshKey, () => "SSH 密钥")
    .with(CipherType.BankAccount, () => "银行账户")
    .with(CipherType.DriversLicense, () => "驾驶证")
    .with(CipherType.Passport, () => "护照")
    .otherwise(() => "登录凭据");
}

function uriMatchLabel(value: number | null): string {
  return match(value)
    .with(0, () => "根域")
    .with(1, () => "主机")
    .with(2, () => "前缀")
    .with(3, () => "完全匹配")
    .with(4, () => "正则")
    .with(5, () => "从不")
    .otherwise(() => "默认");
}

function customFieldTypeLabel(value: number): string {
  return match(value)
    .with(1, () => "隐藏")
    .with(2, () => "布尔")
    .otherwise(() => "文本");
}
</script>

<div class="flex flex-col gap-6">
	<div class="flex items-center justify-between">
		<h3 class="text-lg font-semibold text-foreground">
			{isCreating ? "添加新条目" : "编辑条目"}
		</h3>
		<Button variant="ghost" size="sm" onclick={onCancel}>取消</Button>
	</div>

	<Separator />

	<Field.Group>
		{#if isCreating}
			<Field.Field><Field.Label>条目类型</Field.Label><Select.Root type="single" value={String(form.type)} onValueChange={(value) => form.type = Number(value) as CipherType}><Select.Trigger class="w-full">{cipherTypeLabel(form.type)}</Select.Trigger><Select.Content><Select.Group><Select.Item value={String(CipherType.Login)}>登录凭据</Select.Item><Select.Item value={String(CipherType.SecureNote)}>安全便签</Select.Item><Select.Item value={String(CipherType.Card)}>支付卡片</Select.Item><Select.Item value={String(CipherType.Identity)}>个人身份</Select.Item><Select.Item value={String(CipherType.SshKey)}>SSH 密钥</Select.Item><Select.Item value={String(CipherType.BankAccount)}>银行账户</Select.Item><Select.Item value={String(CipherType.DriversLicense)}>驾驶证</Select.Item><Select.Item value={String(CipherType.Passport)}>护照</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field>
		{/if}

		<Field.Field><Field.Label for="cipher-name">条目名称</Field.Label><Input id="cipher-name" bind:value={form.name} placeholder="例如：我的个人邮箱" /></Field.Field>

		<Field.Field data-disabled={isEditing}><Field.Label>所有者</Field.Label><Select.Root type="single" value={form.organizationId ?? "__personal"} disabled={isEditing} onValueChange={(value) => { form.organizationId = value === "__personal" ? null : value; changeOwner(); }}><Select.Trigger class="w-full">{form.organizationId ? organizations.find((organization) => organization.id === form.organizationId)?.name ?? "组织" : "我的保险库"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="__personal">我的保险库</Select.Item>{#each organizations as organization}<Select.Item value={organization.id}>{organization.name}</Select.Item>{/each}</Select.Group></Select.Content></Select.Root></Field.Field>

		{#if form.organizationId}
			<Field.FieldSet><Field.FieldLegend>集合</Field.FieldLegend><Field.FieldGroup>
				{#each collections.filter((collection) => collection.organizationId === form.organizationId) as collection}
					<Field.Field orientation="horizontal" data-disabled={Boolean(collection.readOnly)}><Checkbox checked={form.collectionIds.includes(collection.id)} disabled={Boolean(collection.readOnly)} onCheckedChange={(checked) => toggleCollection(collection.id, checked)} /><Field.Label>{collection.name}{collection.readOnly ? "（只读）" : ""}</Field.Label></Field.Field>
				{/each}
			</Field.FieldGroup></Field.FieldSet>
		{:else}
			<Field.Field><Field.Label>文件夹</Field.Label><Select.Root type="single" value={form.folderId ?? "__none"} onValueChange={(value) => form.folderId = value === "__none" ? null : value}><Select.Trigger class="w-full">{form.folderId ? folders.find((folder) => folder.id === form.folderId)?.name ?? "选择文件夹" : "无"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="__none">无</Select.Item>{#each folders as folder}<Select.Item value={folder.id}>{folder.name}</Select.Item>{/each}</Select.Group></Select.Content></Select.Root></Field.Field>
		{/if}

		<Field.Field orientation="horizontal"><Checkbox id="favorite" bind:checked={form.favorite} /><Field.Label for="favorite">设为收藏</Field.Label></Field.Field>

		{#if form.type === CipherType.Login}
			<Field.FieldSet class="border-t pt-4"><Field.FieldLegend>登录信息</Field.FieldLegend><Field.FieldGroup>
				<Field.Field><Field.Label>用户名</Field.Label><Input bind:value={form.loginUsername} placeholder="用户名" /></Field.Field>
				<Field.Field><Field.Label>密码</Field.Label><Input type="password" bind:value={form.loginPassword} placeholder="密码" /></Field.Field>
				<div class="flex flex-col gap-2">
					<div class="flex items-center justify-between"><Field.Label>网页链接</Field.Label><Button type="button" size="xs" variant="ghost" onclick={() => form.loginUris = [...form.loginUris, { uri: "", match: null }]}><Plus data-icon="inline-start" />添加</Button></div>
					{#each form.loginUris as uri, index}
						<div class="flex gap-2"><Input bind:value={uri.uri} placeholder="https://example.com" /><Select.Root type="single" value={uri.match == null ? "__default" : String(uri.match)} onValueChange={(value) => uri.match = value === "__default" ? null : Number(value)}><Select.Trigger class="w-28">{uriMatchLabel(uri.match)}</Select.Trigger><Select.Content><Select.Group><Select.Item value="__default">默认</Select.Item><Select.Item value="0">根域</Select.Item><Select.Item value="1">主机</Select.Item><Select.Item value="2">前缀</Select.Item><Select.Item value="3">完全匹配</Select.Item><Select.Item value="4">正则</Select.Item><Select.Item value="5">从不</Select.Item></Select.Group></Select.Content></Select.Root>{#if form.loginUris.length > 1}<Button type="button" variant="ghost" size="icon-sm" onclick={() => form.loginUris = form.loginUris.filter((_, itemIndex) => itemIndex !== index)} aria-label="删除网址"><Trash2 data-icon /></Button>{/if}</div>
					{/each}
				</div>
				<Field.Field>
					<div class="flex items-center justify-between"><Field.Label>TOTP 密钥、otpauth 或 steam URI</Field.Label><Button type="button" size="xs" variant="ghost" onclick={() => totpQrInput?.click()}><ScanLine data-icon="inline-start" />扫描二维码</Button></div>
					<Input bind:value={form.loginTotp} autocomplete="off" />
					<input bind:this={totpQrInput} type="file" accept="image/*" class="hidden" onchange={importTotpQr} />
					{#if totpQrError}<p class="text-xs text-destructive" role="alert">{totpQrError}</p>{/if}
				</Field.Field>
			</Field.FieldGroup></Field.FieldSet>
		{/if}

		{#if form.type === CipherType.Card}
			<Field.FieldSet class="border-t pt-4"><Field.FieldLegend>支付卡片</Field.FieldLegend><Field.FieldGroup><Field.Field><Field.Label>持卡人姓名</Field.Label><Input bind:value={form.cardholderName} placeholder="持卡人" /></Field.Field><Field.Field><Field.Label>卡号</Field.Label><Input bind:value={form.cardNumber} placeholder="卡号" /></Field.Field></Field.FieldGroup></Field.FieldSet>
		{/if}

		{#if form.type >= CipherType.SshKey}
			<Field.Field class="border-t pt-4"><Field.Label>类型数据（JSON）</Field.Label><Textarea bind:value={form.extraData} rows={10} class="font-mono text-xs" /><Field.Description>对象中的所有字符串都会在发送前逐字段加密。</Field.Description></Field.Field>
		{/if}

		<div class="flex flex-col gap-3 border-t pt-4">
			<div class="flex items-center justify-between"><Field.Label>自定义字段</Field.Label><Button type="button" size="xs" variant="ghost" onclick={() => form.customFields = [...form.customFields, { name: "", value: "", type: 0 }]}><Plus data-icon="inline-start" />添加</Button></div>
			{#each form.customFields as field, index}
				<div class="grid grid-cols-[1fr_1fr_auto] gap-2"><Input bind:value={field.name} placeholder="字段名" /><Input bind:value={field.value} type={field.type === 1 ? "password" : "text"} placeholder="字段值" /><Button type="button" variant="ghost" size="icon-sm" onclick={() => form.customFields = form.customFields.filter((_, itemIndex) => itemIndex !== index)} aria-label="删除字段"><Trash2 data-icon /></Button><div class="col-span-2"><Select.Root type="single" value={String(field.type)} onValueChange={(value) => field.type = Number(value)}><Select.Trigger class="w-full">{customFieldTypeLabel(field.type)}</Select.Trigger><Select.Content><Select.Group><Select.Item value="0">文本</Select.Item><Select.Item value="1">隐藏</Select.Item><Select.Item value="2">布尔</Select.Item></Select.Group></Select.Content></Select.Root></div></div>
			{/each}
		</div>

		{#if form.type === CipherType.Identity}
			<Field.FieldSet class="border-t pt-4"><Field.FieldLegend>个人身份</Field.FieldLegend><Field.FieldGroup><div class="grid grid-cols-2 gap-2"><Field.Field><Field.Label>姓</Field.Label><Input bind:value={form.lastName} placeholder="姓" /></Field.Field><Field.Field><Field.Label>名</Field.Label><Input bind:value={form.firstName} placeholder="名" /></Field.Field></div><Field.Field><Field.Label>证件号码</Field.Label><Input bind:value={form.identityNumber} placeholder="身份证/护照等号码" /></Field.Field></Field.FieldGroup></Field.FieldSet>
		{/if}

		<Field.Field class="border-t pt-4"><Field.Label>便签 / 备注</Field.Label><Textarea bind:value={form.notes} rows={4} placeholder="便签内容..." /></Field.Field>
	</Field.Group>

	<div class="flex gap-2 pt-2">
		<Button onclick={onSave} class="flex-1">保存</Button>
		{#if isEditing}<Button onclick={onDelete} variant="destructive">删除</Button>{/if}
	</div>
</div>
