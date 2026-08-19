<script lang="ts">
import { Download } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";

let {
  file = $bindable(),
  replaceExisting = $bindable(),
  allowChecksumMismatch = $bindable(),
  restoring,
  onExport,
  onImport,
}: {
  file: File | undefined;
  replaceExisting: boolean;
  allowChecksumMismatch: boolean;
  restoring: boolean;
  onExport: () => void;
  onImport: () => void;
} = $props();
</script>

<Card.Root>
	<Card.Header><Card.Title>手动备份与恢复</Card.Title><Card.Description>下载加密备份包，或从已有备份恢复数据。</Card.Description></Card.Header>
	<Card.Content><Field.Group>
		<Button variant="outline" size="sm" onclick={onExport} class="w-full">
			<Download data-icon="inline-start" />导出本地备份 (.zip)
		</Button>
		<Separator />
		<Field.Field>
			<Field.Label for="local-backup-file">从本地文件恢复</Field.Label>
		<Input id="local-backup-file"
			type="file"
			accept=".zip"
			onchange={(event) => (file = event.currentTarget.files?.[0])}
		/>
		</Field.Field>
		<Field.FieldSet><Field.FieldLegend>恢复选项</Field.FieldLegend><Field.FieldGroup><Field.Field orientation="horizontal"><Checkbox id="replace-existing" bind:checked={replaceExisting} /><Field.Label for="replace-existing">替换现有数据</Field.Label></Field.Field><Field.Field orientation="horizontal"><Checkbox id="ignore-checksum" bind:checked={allowChecksumMismatch} /><Field.Label for="ignore-checksum">忽略校验和错误</Field.Label></Field.Field></Field.FieldGroup></Field.FieldSet>
		<Button variant="outline" size="sm" onclick={onImport} disabled={!file || restoring} class="w-full">
			{#if restoring}<Spinner data-icon="inline-start" />正在导入...{:else}导入并应用{/if}
		</Button>
	</Field.Group></Card.Content>
</Card.Root>
