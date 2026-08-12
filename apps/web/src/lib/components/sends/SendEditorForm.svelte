<script lang="ts">
import { Eye, EyeOff, File as FileIcon, FileText } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";

let {
	isCreating,
	isEditing,
	sendType = $bindable(),
	name = $bindable(),
	textContent = $bindable(),
	file = $bindable(),
	maxAccessCount = $bindable(),
	expirationDate = $bindable(),
	deletionDays = $bindable(),
	password = $bindable(),
	protectWithPassword = $bindable(),
	hideEmail = $bindable(),
	disabled = $bindable(),
	hasExistingPassword,
	onSave,
	onCancel,
}: {
	isCreating: boolean;
	isEditing: boolean;
	sendType: number;
	name: string;
	textContent: string;
	file: File | null;
	maxAccessCount: number | null;
	expirationDate: string;
	deletionDays: number;
	password: string;
	protectWithPassword: boolean;
	hideEmail: boolean;
	disabled: boolean;
	hasExistingPassword: boolean;
	onSave: () => void;
	onCancel: () => void;
} = $props();

let showPassword = $state(false);

function handleFileChange(event: Event) {
	file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
	if (file && !name) name = file.name;
}
</script>

<div class="space-y-5">
	<div class="flex items-center justify-between"><h3 class="font-bold text-lg text-slate-900 dark:text-slate-100">{isCreating ? "新建安全 Send" : "编辑 Send"}</h3><Button variant="ghost" size="sm" onclick={onCancel} class="text-slate-500 hover:text-red-500">取消</Button></div>
	<hr class="border-slate-200 dark:border-slate-800" />
	<div class="space-y-4">
		{#if isCreating}<div class="space-y-1.5"><span class="text-xs font-bold text-slate-400 uppercase tracking-wider">分享类型</span><div class="grid grid-cols-2 gap-2"><button class="py-2.5 rounded-lg border text-sm font-semibold flex items-center justify-center gap-2 transition-colors {sendType === 0 ? 'bg-primary border-primary text-primary-foreground' : 'bg-white dark:bg-slate-800 border-slate-200 text-slate-650 hover:bg-slate-50'}" onclick={() => sendType = 0}><FileText class="size-4" />加密文本</button><button class="py-2.5 rounded-lg border text-sm font-semibold flex items-center justify-center gap-2 transition-colors {sendType === 1 ? 'bg-primary border-primary text-primary-foreground' : 'bg-white dark:bg-slate-800 border-slate-200 text-slate-650 hover:bg-slate-50'}" onclick={() => sendType = 1}><FileIcon class="size-4" />加密文件</button></div></div>{/if}
		<div class="space-y-1.5"><span class="text-xs font-bold text-slate-400 uppercase tracking-wider">分享名称</span><Input bind:value={name} placeholder="例如: 财务表格或密码备份" /></div>
		{#if sendType === 0}<div class="space-y-1.5"><span class="text-xs font-bold text-slate-400 uppercase tracking-wider">文本内容</span><textarea bind:value={textContent} rows="6" placeholder="在此输入需要发送的敏感文字内容（客户端加密传输）..." class="w-full p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-y"></textarea></div>{:else if isCreating}<div class="space-y-1.5"><span class="text-xs font-bold text-slate-400 uppercase tracking-wider">选择文件</span><input type="file" class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600" onchange={handleFileChange} /></div>{/if}
		<div class="space-y-4 border-t border-slate-250 dark:border-slate-800 pt-4">
			<span class="text-xs font-bold text-slate-400 uppercase tracking-wider block">安全与失效选项</span>
			<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-500">限次失效 (最大访问次数)</span><Input type="number" min="1" bind:value={maxAccessCount} placeholder="例如：1 (留空则不限)" /></div>
			<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-500">自动销毁时间 (最长 30 天)</span><select bind:value={deletionDays} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"><option value={1}>1 天后硬删除</option><option value={3}>3 天后硬删除</option><option value={7}>7 天后硬删除</option><option value={14}>14 天后硬删除</option><option value={30}>30 天后硬删除</option></select></div>
			<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-500">过期时间 (此时间后禁止下载，但保留记录)</span><input type="datetime-local" bind:value={expirationDate} class="w-full p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" /></div>
			<div class="space-y-1.5"><label class="flex items-center gap-2 text-xs font-semibold text-slate-500"><input type="checkbox" bind:checked={protectWithPassword} class="size-4 rounded" />启用访问密码</label><div class="relative"><Input type={showPassword ? "text" : "password"} bind:value={password} placeholder={isEditing && hasExistingPassword ? "留空以保留现有密码" : "输入访问密码"} disabled={!protectWithPassword} class="pr-10" /><button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650" onclick={() => showPassword = !showPassword}>{#if showPassword}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}</button></div></div>
			<div class="flex items-center gap-2 py-1"><input type="checkbox" id="hideEmail" bind:checked={hideEmail} class="rounded border-slate-300 text-primary focus:ring-primary size-4" /><label for="hideEmail" class="text-sm font-semibold text-slate-600 cursor-pointer">隐藏我的邮箱地址</label></div>
			<div class="flex items-center gap-2 py-1"><input type="checkbox" id="disabled" bind:checked={disabled} class="rounded border-slate-300 text-primary focus:ring-primary size-4" /><label for="disabled" class="text-sm font-semibold text-slate-600 cursor-pointer">立即禁用此链接</label></div>
		</div>
	</div>
	<Button onclick={onSave} class="w-full bg-primary text-primary-foreground font-semibold py-2.5">创建并加密传输</Button>
</div>
