<script lang="ts">
import type { CustomEquivalentDomain } from "@edgewarden/shared";
import { Edit, Globe, Plus, Trash2 } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Checkbox } from "$lib/components/ui/checkbox/index.js";
import * as Empty from "$lib/components/ui/empty/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import {
	createEquivalentDomainRuleId,
	normalizeEquivalentDomainRule,
} from "$lib/services/equivalent-domains";
import { cn } from "$lib/utils";

let {
	rules = $bindable(),
	onSuccess,
	onError,
}: {
	rules: CustomEquivalentDomain[];
	onSuccess: (message: string) => void;
	onError: (message: string) => void;
} = $props();

let editingRuleId = $state<string | null>(null);
let editingDomains = $state<string[]>(["", ""]);
let editingInvalidIndexes = $state<Set<number>>(new Set());
let newRuleDomains = $state<string[] | null>(null);
let newRuleInvalidIndexes = $state<Set<number>>(new Set());

function startAdd() {
	newRuleDomains = ["", ""];
	newRuleInvalidIndexes = new Set();
	editingRuleId = null;
}

function startEdit(rule: CustomEquivalentDomain) {
	editingRuleId = rule.id;
	editingDomains = [...rule.domains];
	editingInvalidIndexes = new Set();
	newRuleDomains = null;
}

function cancelEditor(isNew: boolean) {
	if (isNew) newRuleDomains = null;
	else editingRuleId = null;
}

function addDomain(isNew: boolean) {
	if (isNew && newRuleDomains) newRuleDomains = [...newRuleDomains, ""];
	else editingDomains = [...editingDomains, ""];
}

function removeDomain(isNew: boolean, index: number) {
	if (isNew && newRuleDomains?.length && newRuleDomains.length > 2) {
		newRuleDomains = newRuleDomains.filter(
			(_, itemIndex) => itemIndex !== index,
		);
		newRuleInvalidIndexes = new Set();
	} else if (!isNew && editingDomains.length > 2) {
		editingDomains = editingDomains.filter(
			(_, itemIndex) => itemIndex !== index,
		);
		editingInvalidIndexes = new Set();
	}
}

function validate(domains: string[], isNew: boolean) {
	const normalized = normalizeEquivalentDomainRule(domains);
	if (isNew) newRuleInvalidIndexes = normalized.invalidIndexes;
	else editingInvalidIndexes = normalized.invalidIndexes;
	if (normalized.invalidIndexes.size) {
		onError("部分域名格式不正确，请修改标记的内容。");
		return null;
	}
	if (!normalized.valid) {
		onError("每条规则必须包含至少 2 个有效的等效域名。");
		return null;
	}
	return normalized.domains;
}

function confirmNew() {
	if (!newRuleDomains) return;
	const domains = validate(newRuleDomains, true);
	if (!domains) return;
	rules = [
		{ id: createEquivalentDomainRuleId(), domains, excluded: false },
		...rules,
	];
	newRuleDomains = null;
	newRuleInvalidIndexes = new Set();
	onSuccess("已添加临时规则，请记得点击右上角“保存并应用”。");
}

function confirmEdit() {
	const domains = validate(editingDomains, false);
	if (!domains) return;
	rules = rules.map((rule) =>
		rule.id === editingRuleId ? { ...rule, domains } : rule,
	);
	editingRuleId = null;
	editingDomains = ["", ""];
	editingInvalidIndexes = new Set();
	onSuccess("已更新临时规则，请记得点击右上角“保存并应用”。");
}

function toggleRule(index: number) {
	rules = rules.map((rule, ruleIndex) =>
		ruleIndex === index ? { ...rule, excluded: !rule.excluded } : rule,
	);
}

function deleteRule(index: number) {
	rules = rules.filter((_, ruleIndex) => ruleIndex !== index);
	onSuccess("已删除规则，请记得点击右上角“保存并应用”。");
}
</script>

<Card.Root class="min-h-[500px] min-w-0">
	<Card.Header>
		<Card.Title>自定义规则</Card.Title>
		<Card.Description>创建专属您的等效域名绑定。</Card.Description>
		<Card.Action><Button size="sm" onclick={startAdd} disabled={newRuleDomains !== null}><Plus data-icon="inline-start" />新增规则</Button></Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		{#if newRuleDomains !== null || editingRuleId !== null}
			{@const isNew = newRuleDomains !== null}
			{@const currentFields = isNew ? newRuleDomains! : editingDomains}
			{@const currentInvalids = isNew ? newRuleInvalidIndexes : editingInvalidIndexes}
			<div class="flex flex-col gap-3 rounded-lg border border-dashed p-4">
				<div class="flex items-center justify-between gap-3"><p class="flex items-center gap-2 text-sm font-medium"><Globe />{isNew ? "新建域名等效规则" : "编辑等效规则"}</p><div class="flex gap-2"><Button size="sm" variant="ghost" onclick={() => cancelEditor(isNew)}>取消</Button><Button size="sm" onclick={isNew ? confirmNew : confirmEdit}>确认</Button></div></div>
				<Field.Group>{#each currentFields as _, index}<Field.Field data-invalid={currentInvalids.has(index)}><div class="flex gap-2"><Input placeholder="例如: google.com" bind:value={currentFields[index]} aria-invalid={currentInvalids.has(index)} aria-label={`等效域名 ${index + 1}`} />{#if currentFields.length > 2}<Button variant="ghost" size="icon" onclick={() => removeDomain(isNew, index)} aria-label="移除域名"><Trash2 /></Button>{/if}</div>{#if currentInvalids.has(index)}<Field.Error>请输入有效域名。</Field.Error>{/if}</Field.Field>{/each}</Field.Group>
				<Button variant="outline" size="sm" onclick={() => addDomain(isNew)} class="w-full"><Plus data-icon="inline-start" />添加等效域名</Button>
			</div>
		{/if}

		<div class="flex max-h-[480px] flex-1 flex-col gap-3 overflow-y-auto pr-1">
			{#each rules as rule, index (rule.id)}
				<div class={cn("flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4", rule.excluded && "opacity-60")}>
					<div class="flex min-w-0 flex-1 items-center gap-3"><Checkbox checked={!rule.excluded} onCheckedChange={() => toggleRule(index)} aria-label={rule.excluded ? "启用规则" : "禁用规则"} /><div class="flex min-w-0 flex-1 flex-wrap gap-1.5">{#each rule.domains as domain}<code class="rounded-md border bg-background px-2 py-0.5 text-xs font-semibold">{domain}</code>{/each}</div></div>
					<div class="flex shrink-0 gap-1"><Button variant="ghost" size="icon" onclick={() => startEdit(rule)} aria-label="编辑规则"><Edit /></Button><Button variant="ghost" size="icon" onclick={() => deleteRule(index)} aria-label="删除规则"><Trash2 /></Button></div>
				</div>
			{:else}
				<Empty.Root class="h-full border border-dashed"><Empty.Header><Empty.Media variant="icon"><Globe /></Empty.Media><Empty.Title>暂无自定义等效规则</Empty.Title><Empty.Description>点击“新增规则”定义一组等效域名。</Empty.Description></Empty.Header></Empty.Root>
			{/each}
		</div>
	</Card.Content>
</Card.Root>
