<script lang="ts">
import { Info, RefreshCw, Save, Trash2 } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import type { BackupDestinationForm } from "./destination-form";

let {
	form = $bindable(),
	saving,
	onSave,
	onDelete,
}: {
	form: BackupDestinationForm;
	saving: boolean;
	onSave: () => void;
	onDelete: () => void;
} = $props();
</script>

<!-- Config Form Card -->
<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
	<div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
		<div>
			<h2 class="text-base font-bold text-slate-900 dark:text-slate-50">备份服务配置</h2>
			<p class="text-xs text-slate-500">修改远程 WebDAV 或 S3 连接密钥及桶目录</p>
		</div>
		<div class="flex gap-2">
			<Button variant="ghost" size="sm" onclick={onDelete} disabled={saving} class="text-red-500 hover:text-red-600">
				<Trash2 class="size-4 mr-1.5" />
				删除目的地
			</Button>
			<Button size="sm" onclick={onSave} disabled={saving} class="gap-1.5">
				{#if saving}
					<RefreshCw class="size-3.5 animate-spin" />
				{:else}
					<Save class="size-3.5" />
				{/if}
				保存修改
			</Button>
		</div>
	</div>

	<!-- Generic fields -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<div class="space-y-1.5">
			<label for="backup-name" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">目的地名称</label>
			<Input id="backup-name" type="text" bind:value={form.name} placeholder="例如：我的 Nextcloud 备份" />
		</div>
		<div class="space-y-1.5">
			<label for="backup-type" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">存储协议</label>
			<select id="backup-type" bind:value={form.type} class="w-full flex h-10 rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
				<option value="webdav">WebDAV 协议</option>
				<option value="s3">S3 兼容协议</option>
			</select>
		</div>
		<div class="md:col-span-2 flex items-center gap-2 pt-1.5">
			<input type="checkbox" id="attachments" bind:checked={form.includeAttachments} class="rounded text-primary focus:ring-primary" />
			<label for="attachments" class="text-xs text-slate-700 dark:text-slate-300 select-none cursor-pointer flex items-center gap-1.5">
				同时备份附件文件 (包含 KV/R2 中的文件)
				<Info class="size-3.5 text-slate-400" title="勾选后，备份流程将同步读取附件的二进制流文件放入 ZIP 压缩包。" />
			</label>
		</div>
	</div>

	<!-- WebDAV Protocol Fields -->
	{#if form.type === "webdav"}
		<div class="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
			<h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">WebDAV 存储节点设置</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div class="md:col-span-2 space-y-1.5">
					<label for="dav-url" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">WebDAV 服务器基础 URL</label>
					<Input id="dav-url" type="url" bind:value={form.davBaseUrl} placeholder="https://nextcloud.example.com/remote.php/dav/files/username" />
				</div>
				<div class="space-y-1.5">
					<label for="dav-username" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">用户名</label>
					<Input id="dav-username" type="text" bind:value={form.davUsername} placeholder="用户名" />
				</div>
				<div class="space-y-1.5">
					<label for="dav-password" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">应用密码 / 访问密码</label>
					<Input id="dav-password" type="password" bind:value={form.davPassword} placeholder="密码 (密文显示)" />
				</div>
				<div class="space-y-1.5 md:col-span-2">
					<label for="dav-path" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">备份根目录</label>
					<Input id="dav-path" type="text" bind:value={form.davRemotePath} placeholder="edgewarden" />
				</div>
			</div>
		</div>
	{:else}
		<!-- S3 Protocol Fields -->
		<div class="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
			<h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">S3 兼容对象存储设置</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div class="md:col-span-2 space-y-1.5">
					<label for="s3-endpoint" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Endpoint 端点 URL</label>
					<Input id="s3-endpoint" type="url" bind:value={form.s3Endpoint} placeholder="https://s3.us-east-1.amazonaws.com" />
				</div>
				<div class="space-y-1.5">
					<label for="s3-bucket" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Bucket 存储桶</label>
					<Input id="s3-bucket" type="text" bind:value={form.s3Bucket} placeholder="my-edgewarden-backups" />
				</div>
				<div class="space-y-1.5">
					<label for="s3-region" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Region 区域</label>
					<Input id="s3-region" type="text" bind:value={form.s3Region} placeholder="auto" />
				</div>
				<div class="space-y-1.5">
					<label for="s3-access-key" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Access Key ID</label>
					<Input id="s3-access-key" type="text" bind:value={form.s3AccessKeyId} placeholder="Access Key ID" />
				</div>
				<div class="space-y-1.5">
					<label for="s3-secret-key" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Secret Access Key</label>
					<Input id="s3-secret-key" type="password" bind:value={form.s3SecretAccessKey} placeholder="Secret Access Key" />
				</div>
				<div class="space-y-1.5">
					<label for="s3-addressing" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">Addressing Style 地址模式</label>
					<select id="s3-addressing" bind:value={form.s3AddressingStyle} class="w-full flex h-10 rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
						<option value="path-style">Path Style (路径风格模式)</option>
						<option value="virtual-hosted-style">Virtual Hosted Style (虚拟主机名模式)</option>
					</select>
				</div>
				<div class="space-y-1.5">
					<label for="s3-path" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">备份根目录</label>
					<Input id="s3-path" type="text" bind:value={form.s3RootPath} placeholder="edgewarden" />
				</div>
			</div>
		</div>
	{/if}

	<!-- Schedule Settings Section -->
	<div class="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
		<h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">定时自动备份设定 (Cron Trigger)</h3>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div class="md:col-span-3 flex items-center gap-2">
				<input type="checkbox" id="schedEnabled" bind:checked={form.scheduleEnabled} class="rounded text-primary focus:ring-primary" />
				<label for="schedEnabled" class="text-xs text-slate-700 dark:text-slate-300 select-none cursor-pointer font-semibold">
					启用此目的地的自动定时备份任务
				</label>
			</div>

			<div class="space-y-1.5">
				<label for="schedule-interval" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">备份执行间隔 (小时)</label>
				<Input id="schedule-interval" type="number" bind:value={form.scheduleInterval} min="1" max="99" disabled={!form.scheduleEnabled} />
			</div>

			<div class="space-y-1.5">
				<label for="schedule-time" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">每日首发启动时间</label>
				<Input id="schedule-time" type="text" bind:value={form.scheduleStartTime} placeholder="03:00" disabled={!form.scheduleEnabled} />
			</div>

			<div class="space-y-1.5">
				<label for="schedule-retention" class="text-xs font-medium text-slate-700 dark:text-slate-300 block">最大保留历史文件数 (Retention)</label>
				<Input id="schedule-retention" type="number" bind:value={form.scheduleRetention} placeholder="30" disabled={!form.scheduleEnabled} />
			</div>
		</div>
	</div>
</div>
