<script lang="ts">
import { Info, Save, Trash2 } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Select from "$lib/components/ui/select/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
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
<Card.Root>
	<Card.Header class="flex-row items-start justify-between">
		<div><Card.Title>备份服务配置</Card.Title><Card.Description>修改远程 WebDAV 或 S3 连接密钥及桶目录</Card.Description></div>
		<Card.Action class="flex gap-2">
			<Button variant="ghost" size="sm" onclick={onDelete} disabled={saving} class="text-red-500 hover:text-red-600">
				<Trash2 data-icon="inline-start" />
				删除目的地
			</Button>
			<Button size="sm" onclick={onSave} disabled={saving}>
				{#if saving}
					<Spinner data-icon="inline-start" />
				{:else}
					<Save data-icon="inline-start" />
				{/if}
				保存修改
			</Button>
		</Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-6">

	<!-- Generic fields -->
	<Field.Group class="grid grid-cols-1 md:grid-cols-2">
		<Field.Field>
			<Field.Label for="backup-name">目的地名称</Field.Label>
			<Input id="backup-name" type="text" bind:value={form.name} placeholder="例如：我的 Nextcloud 备份" />
		</Field.Field>
		<Field.Field>
			<Field.Label>存储协议</Field.Label><Select.Root type="single" value={form.type} onValueChange={(value) => form.type = value as typeof form.type}><Select.Trigger class="w-full">{form.type === "webdav" ? "WebDAV 协议" : "S3 兼容协议"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="webdav">WebDAV 协议</Select.Item><Select.Item value="s3">S3 兼容协议</Select.Item></Select.Group></Select.Content></Select.Root>
		</Field.Field>
		<Field.Field class="md:col-span-2" orientation="horizontal">
			<Checkbox id="attachments" bind:checked={form.includeAttachments} />
			<Field.Label for="attachments" class="flex items-center gap-1.5">
				同时备份附件与文件 Send（包含 KV/R2 中的文件）
				<Info class="size-3.5 text-muted-foreground" title="勾选后，备份流程会将附件和文件 Send 的二进制内容写入 ZIP；不勾选时不会导出文件 Send，避免恢复出缺少文件的记录。" />
			</Field.Label>
		</Field.Field>
	</Field.Group>
	<Separator />

	<!-- WebDAV Protocol Fields -->
	{#if form.type === "webdav"}
		<Field.FieldSet>
			<Field.FieldLegend>WebDAV 存储节点设置</Field.FieldLegend>
			<Field.FieldGroup class="grid grid-cols-1 md:grid-cols-2">
				<Field.Field class="md:col-span-2">
					<Field.Label for="dav-url">WebDAV 服务器基础 URL</Field.Label>
					<Input id="dav-url" type="url" bind:value={form.davBaseUrl} placeholder="https://nextcloud.example.com/remote.php/dav/files/username" />
				</Field.Field>
				<Field.Field>
					<Field.Label for="dav-username">用户名</Field.Label>
					<Input id="dav-username" type="text" bind:value={form.davUsername} placeholder="用户名" />
				</Field.Field>
				<Field.Field>
					<Field.Label for="dav-password">应用密码 / 访问密码</Field.Label>
					<Input id="dav-password" type="password" bind:value={form.davPassword} placeholder="密码 (密文显示)" />
				</Field.Field>
				<Field.Field class="md:col-span-2">
					<Field.Label for="dav-path">备份根目录</Field.Label>
					<Input id="dav-path" type="text" bind:value={form.davRemotePath} placeholder="edgewarden" />
				</Field.Field>
			</Field.FieldGroup>
		</Field.FieldSet>
	{:else}
		<!-- S3 Protocol Fields -->
		<Field.FieldSet>
			<Field.FieldLegend>S3 兼容对象存储设置</Field.FieldLegend>
			<Field.FieldGroup class="grid grid-cols-1 md:grid-cols-2">
				<Field.Field class="md:col-span-2">
					<Field.Label for="s3-endpoint">Endpoint 端点 URL</Field.Label>
					<Input id="s3-endpoint" type="url" bind:value={form.s3Endpoint} placeholder="https://s3.us-east-1.amazonaws.com" />
				</Field.Field>
				<Field.Field><Field.Label for="s3-bucket">Bucket 存储桶</Field.Label>
					<Input id="s3-bucket" type="text" bind:value={form.s3Bucket} placeholder="my-edgewarden-backups" />
				</Field.Field>
				<Field.Field><Field.Label for="s3-region">Region 区域</Field.Label>
					<Input id="s3-region" type="text" bind:value={form.s3Region} placeholder="auto" />
				</Field.Field>
				<Field.Field><Field.Label for="s3-access-key">Access Key ID</Field.Label>
					<Input id="s3-access-key" type="text" bind:value={form.s3AccessKeyId} placeholder="Access Key ID" />
				</Field.Field>
				<Field.Field><Field.Label for="s3-secret-key">Secret Access Key</Field.Label>
					<Input id="s3-secret-key" type="password" bind:value={form.s3SecretAccessKey} placeholder="Secret Access Key" />
				</Field.Field>
				<Field.Field><Field.Label>Addressing Style 地址模式</Field.Label><Select.Root type="single" value={form.s3AddressingStyle} onValueChange={(value) => form.s3AddressingStyle = value as typeof form.s3AddressingStyle}><Select.Trigger class="w-full">{form.s3AddressingStyle === "path-style" ? "Path Style（路径风格）" : "Virtual Hosted Style（虚拟主机名）"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="path-style">Path Style（路径风格）</Select.Item><Select.Item value="virtual-hosted-style">Virtual Hosted Style（虚拟主机名）</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field>
				<Field.Field><Field.Label for="s3-path">备份根目录</Field.Label>
					<Input id="s3-path" type="text" bind:value={form.s3RootPath} placeholder="edgewarden" />
				</Field.Field>
			</Field.FieldGroup>
		</Field.FieldSet>
	{/if}

	<!-- Schedule Settings Section -->
	<Field.FieldSet>
		<Field.FieldLegend>定时自动备份设定 (Cron Trigger)</Field.FieldLegend>
		<Field.FieldGroup class="grid grid-cols-1 md:grid-cols-3">
			<Field.Field class="md:col-span-3" orientation="horizontal">
				<Checkbox id="schedEnabled" bind:checked={form.scheduleEnabled} />
				<Field.Label for="schedEnabled">
					启用此目的地的自动定时备份任务
				</Field.Label>
			</Field.Field>

			<Field.Field data-disabled={!form.scheduleEnabled}>
				<Field.Label for="schedule-interval">备份执行间隔 (小时)</Field.Label>
				<Input id="schedule-interval" type="number" bind:value={form.scheduleInterval} min="1" max="99" disabled={!form.scheduleEnabled} />
			</Field.Field>

			<Field.Field data-disabled={!form.scheduleEnabled}><Field.Label>每日首个备份小时</Field.Label><Select.Root type="single" value={form.scheduleStartTime} disabled={!form.scheduleEnabled} onValueChange={(value) => form.scheduleStartTime = value}><Select.Trigger class="w-full">{form.scheduleStartTime}</Select.Trigger><Select.Content><Select.Group>{#each Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`) as hour}<Select.Item value={hour}>{hour}</Select.Item>{/each}</Select.Group></Select.Content></Select.Root><Field.Description>任务每小时检查一次，会在所选小时内执行，不保证精确到分钟。</Field.Description></Field.Field>

			<Field.Field data-disabled={!form.scheduleEnabled}>
				<Field.Label for="schedule-retention">最大保留历史文件数 (Retention)</Field.Label>
				<Input id="schedule-retention" type="number" bind:value={form.scheduleRetention} placeholder="30" disabled={!form.scheduleEnabled} />
			</Field.Field>
		</Field.FieldGroup>
	</Field.FieldSet>
	</Card.Content>
</Card.Root>
