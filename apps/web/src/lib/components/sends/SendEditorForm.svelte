<script lang="ts">
import { Eye, EyeOff, File as FileIcon, FileText } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Select from "$lib/components/ui/select/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import { Textarea } from "$lib/components/ui/textarea/index.js";
import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";

let {
	isCreating,
	isEditing,
	form = $bindable(),
	hasExistingPassword,
	onSave,
	onCancel,
}: {
	isCreating: boolean;
	isEditing: boolean;
	form: import("$lib/services/send-editor").SendEditorDraft;
	hasExistingPassword: boolean;
	onSave: () => void;
	onCancel: () => void;
} = $props();

let showPassword = $state(false);

function handleFileChange(event: Event) {
	form.file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
	if (form.file && !form.name) form.name = form.file.name;
}
</script>

<div class="flex flex-col gap-5">
	<div class="flex items-center justify-between"><h3 class="text-lg font-semibold">{isCreating ? "新建安全 Send" : "编辑 Send"}</h3><Button variant="ghost" size="sm" onclick={onCancel}>取消</Button></div>
	<Separator />
	<Field.Group>
		{#if isCreating}<Field.Field><Field.Label>分享类型</Field.Label><ToggleGroup.Root type="single" variant="outline" class="grid w-full grid-cols-2" value={String(form.type)} onValueChange={(value) => { if (value) form.type = Number(value); }}><ToggleGroup.Item value="0"><FileText data-icon="inline-start" />加密文本</ToggleGroup.Item><ToggleGroup.Item value="1"><FileIcon data-icon="inline-start" />加密文件</ToggleGroup.Item></ToggleGroup.Root></Field.Field>{/if}
		<Field.Field><Field.Label for="send-name">分享名称</Field.Label><Input id="send-name" bind:value={form.name} placeholder="例如：财务表格或密码备份" /></Field.Field>
		{#if form.type === 0}<Field.Field><Field.Label for="send-content">文本内容</Field.Label><Textarea id="send-content" bind:value={form.textContent} rows={6} placeholder="在此输入需要发送的敏感文字内容（客户端加密传输）..." /></Field.Field>{:else if isCreating}<Field.Field><Field.Label for="send-file">选择文件</Field.Label><Input id="send-file" type="file" onchange={handleFileChange} /></Field.Field>{/if}
		<Field.FieldSet class="border-t pt-4"><Field.FieldLegend>安全与失效选项</Field.FieldLegend><Field.FieldGroup>
			<Field.Field><Field.Label for="max-access-count">最大访问次数</Field.Label><Input id="max-access-count" type="number" min="1" bind:value={form.maxAccessCount} placeholder="留空则不限" /><Field.Description>达到次数后链接立即失效。</Field.Description></Field.Field>
			<Field.Field><Field.Label>自动销毁时间</Field.Label><Select.Root type="single" value={String(form.deletionDays)} onValueChange={(value) => form.deletionDays = Number(value)}><Select.Trigger class="w-full">{form.deletionDays} 天后硬删除</Select.Trigger><Select.Content><Select.Group>{#each [1, 3, 7, 14, 30] as days}<Select.Item value={String(days)}>{days} 天后硬删除</Select.Item>{/each}</Select.Group></Select.Content></Select.Root></Field.Field>
			<Field.Field><Field.Label for="expiration-date">过期时间</Field.Label><Input id="expiration-date" type="datetime-local" bind:value={form.expirationDate} /><Field.Description>此时间后禁止访问，但保留管理记录。</Field.Description></Field.Field>
			<Field.Field orientation="horizontal"><Checkbox id="protect-send" bind:checked={form.protectWithPassword} /><Field.Label for="protect-send">启用访问密码</Field.Label></Field.Field>
			<Field.Field data-disabled={!form.protectWithPassword}><Field.Label for="send-password">访问密码</Field.Label><div class="relative"><Input id="send-password" type={showPassword ? "text" : "password"} bind:value={form.password} placeholder={isEditing && hasExistingPassword ? "留空以保留现有密码" : "输入访问密码"} disabled={!form.protectWithPassword} class="pr-10" /><Button type="button" variant="ghost" size="icon-xs" class="absolute right-1 top-1/2 -translate-y-1/2" onclick={() => showPassword = !showPassword} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{#if showPassword}<EyeOff data-icon />{:else}<Eye data-icon />{/if}</Button></div></Field.Field>
			<Field.Field orientation="horizontal"><Checkbox id="hideEmail" bind:checked={form.hideEmail} /><Field.Label for="hideEmail">隐藏我的邮箱地址</Field.Label></Field.Field>
			<Field.Field orientation="horizontal"><Checkbox id="disabled" bind:checked={form.disabled} /><Field.Label for="disabled">立即禁用此链接</Field.Label></Field.Field>
		</Field.FieldGroup></Field.FieldSet>
	</Field.Group>
	<Button onclick={onSave} class="w-full">{isCreating ? "创建并加密传输" : "保存更改"}</Button>
</div>
