<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { isLoggedIn } from "$lib/services/api";
import { vault } from "$lib/stores/vault.svelte";
import { fetchDomainRules, updateDomainRules } from "$lib/services/api";
import {
	createEquivalentDomainRuleId,
	normalizeEquivalentDomainRule,
} from "$lib/services/equivalent-domains";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import {
	ArrowLeft,
	Save,
	Plus,
	Trash2,
	Edit,
	Check,
	X,
	Search,
	Globe,
	ShieldCheck,
	RefreshCw,
	AlertCircle,
	Info,
	ToggleLeft,
	ToggleRight,
	CheckSquare,
	Square,
} from "@lucide/svelte";
import type {
	CustomEquivalentDomain,
	GlobalEquivalentDomain,
} from "@edgewarden/shared";

// Page state
let loading = $state(true);
let saving = $state(false);
let error = $state("");
let successMsg = $state("");

// Domain rules data
let customRules = $state<CustomEquivalentDomain[]>([]);
let globalRules = $state<GlobalEquivalentDomain[]>([]);
let excludedTypes = $state<Set<number>>(new Set());

// Searching and filtering
let searchQuery = $state("");

// Edit/Add states
let editingRuleId = $state<string | null>(null);
let editingDomains = $state<string[]>(["", ""]);
let editingInvalidIndexes = $state<Set<number>>(new Set());

let newRuleDomains = $state<string[] | null>(null);
let newRuleInvalidIndexes = $state<Set<number>>(new Set());

onMount(async () => {
	if (!isLoggedIn()) {
		goto("/login");
		return;
	}
	if (!vault.isUnlocked) {
		goto("/vault/unlock");
		return;
	}
	await loadRules();
});

async function loadRules() {
	loading = true;
	error = "";
	try {
		const res = await fetchDomainRules();
		// Convert to mutable state arrays
		customRules = res.customEquivalentDomains.map((r) => ({
			id: r.id,
			domains: [...r.domains],
			excluded: !!r.excluded,
		}));
		globalRules = res.globalEquivalentDomains.map((g) => ({
			type: g.type,
			domains: [...g.domains],
			excluded: !!g.excluded,
		}));
		excludedTypes = new Set(
			res.globalEquivalentDomains.filter((g) => g.excluded).map((g) => g.type),
		);
	} catch (e: any) {
		error = e.message || "加载域名规则失败，请稍后重试。";
	} finally {
		loading = false;
	}
}

// Custom rule actions
function handleToggleCustomRule(index: number) {
	customRules[index].excluded = !customRules[index].excluded;
}

function handleAddCustomRule() {
	newRuleDomains = ["", ""];
	newRuleInvalidIndexes = new Set();
	editingRuleId = null;
}

function handleAddDomainField(isNewRule: boolean) {
	if (isNewRule) {
		if (newRuleDomains) newRuleDomains = [...newRuleDomains, ""];
	} else {
		editingDomains = [...editingDomains, ""];
	}
}

function handleRemoveDomainField(isNewRule: boolean, index: number) {
	if (isNewRule) {
		if (newRuleDomains && newRuleDomains.length > 2) {
			newRuleDomains = newRuleDomains.filter((_, i) => i !== index);
			newRuleInvalidIndexes.delete(index);
		}
	} else {
		if (editingDomains.length > 2) {
			editingDomains = editingDomains.filter((_, i) => i !== index);
			editingInvalidIndexes.delete(index);
		}
	}
}

function handleConfirmNewRule() {
	if (!newRuleDomains) return;
	const normalizedRule = normalizeEquivalentDomainRule(newRuleDomains);
	newRuleInvalidIndexes = normalizedRule.invalidIndexes;
	if (normalizedRule.invalidIndexes.size > 0) {
		showTimedError("部分域名格式不正确，请修改红框中的内容。");
		return;
	}

	if (!normalizedRule.valid) {
		showTimedError("每条规则必须包含至少 2 个有效的等效域名。");
		return;
	}

	const newId = createEquivalentDomainRuleId();
	customRules = [
		{ id: newId, domains: normalizedRule.domains, excluded: false },
		...customRules,
	];
	newRuleDomains = null;
	newRuleInvalidIndexes = new Set();
	showTimedSuccess("已添加临时规则，请记得点击右上角“保存并应用”。");
}

function handleStartEditRule(rule: CustomEquivalentDomain) {
	editingRuleId = rule.id;
	editingDomains = [...rule.domains];
	editingInvalidIndexes = new Set();
	newRuleDomains = null;
}

function handleConfirmEditRule() {
	const normalizedRule = normalizeEquivalentDomainRule(editingDomains);
	editingInvalidIndexes = normalizedRule.invalidIndexes;
	if (normalizedRule.invalidIndexes.size > 0) {
		showTimedError("部分域名格式不正确，请修改红框中的内容。");
		return;
	}

	if (!normalizedRule.valid) {
		showTimedError("每条规则必须包含至少 2 个有效的等效域名。");
		return;
	}

	customRules = customRules.map((r) =>
		r.id === editingRuleId ? { ...r, domains: normalizedRule.domains } : r,
	);
	editingRuleId = null;
	editingDomains = ["", ""];
	editingInvalidIndexes = new Set();
	showTimedSuccess("已更新临时规则，请记得点击右上角“保存并应用”。");
}

function handleDeleteCustomRule(index: number) {
	customRules = customRules.filter((_, i) => i !== index);
	showTimedSuccess("已删除规则，请记得点击右上角“保存并应用”。");
}

// Global rule actions
function handleToggleGlobalRule(type: number) {
	if (excludedTypes.has(type)) {
		excludedTypes.delete(type);
	} else {
		excludedTypes.add(type);
	}
	excludedTypes = new Set(excludedTypes); // trigger reactivity
}

// Save & Sync
async function handleSave() {
	saving = true;
	error = "";
	successMsg = "";
	try {
		// Clean rules first
		const payloadRules = customRules
			.map((r) => ({
				...r,
				domains: normalizeEquivalentDomainRule(r.domains).domains,
			}))
			.filter((r) => r.domains.length >= 2);

		const excludedList = Array.from(excludedTypes);

		const updated = await updateDomainRules(payloadRules, excludedList);

		// Sync local store state too
		customRules = updated.customEquivalentDomains.map((r) => ({
			id: r.id,
			domains: [...r.domains],
			excluded: !!r.excluded,
		}));
		excludedTypes = new Set(
			updated.globalEquivalentDomains
				.filter((g) => g.excluded)
				.map((g) => g.type),
		);

		showTimedSuccess("等效域名规则已成功保存并应用！");
	} catch (e: any) {
		error = e.message || "保存规则失败，请稍后重试。";
	} finally {
		saving = false;
	}
}

// Derived globals filtering
let filteredGlobals = $derived(
	globalRules.filter((rule) => {
		if (!searchQuery.trim()) return true;
		const query = searchQuery.toLowerCase().trim();
		return rule.domains.some((d) => d.includes(query));
	}),
);

// Helpers for notifications
let notificationTimeout: any;
function showTimedSuccess(msg: string) {
	successMsg = msg;
	error = "";
	if (notificationTimeout) clearTimeout(notificationTimeout);
	notificationTimeout = setTimeout(() => {
		successMsg = "";
	}, 4000);
}

function showTimedError(msg: string) {
	error = msg;
	successMsg = "";
	if (notificationTimeout) clearTimeout(notificationTimeout);
	notificationTimeout = setTimeout(() => {
		error = "";
	}, 4000);
}
</script>

<svelte:head>
	<title>域名等效规则 - Edgewarden</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
	<!-- Navbar Header -->
	<header class="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between shrink-0">
		<div class="flex items-center gap-3">
			<Button variant="ghost" size="icon" onclick={() => goto("/vault")} class="size-9 rounded-lg">
				<ArrowLeft class="size-4" />
			</Button>
			<div class="flex items-center gap-2">
				<Globe class="size-5 text-primary" />
				<h1 class="font-bold text-base text-slate-800 dark:text-slate-100">域名等效规则</h1>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				onclick={loadRules}
				disabled={loading || saving}
				class="gap-1.5 h-9"
			>
				<RefreshCw class="size-3.5 {loading ? 'animate-spin' : ''}" />
				同步刷新
			</Button>
			<Button
				onclick={handleSave}
				disabled={loading || saving}
				class="gap-1.5 h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
			>
				<Save class="size-3.5" />
				{saving ? "正在保存..." : "保存并应用"}
			</Button>
		</div>
	</header>

	<main class="flex-1 overflow-y-auto p-6 md:p-8 max-w-6xl w-full mx-auto space-y-6">
		<!-- Notification Alerts -->
		{#if error}
			<div class="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-400 flex gap-3 items-start animate-in fade-in slide-in-from-top-2 duration-200">
				<AlertCircle class="size-5 shrink-0 mt-0.5" />
				<div>
					<p class="text-sm font-semibold">操作提示</p>
					<p class="text-xs mt-0.5 leading-relaxed">{error}</p>
				</div>
			</div>
		{/if}

		{#if successMsg}
			<div class="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-400 flex gap-3 items-start animate-in fade-in slide-in-from-top-2 duration-200">
				<ShieldCheck class="size-5 shrink-0 mt-0.5" />
				<div>
					<p class="text-sm font-semibold">成功</p>
					<p class="text-xs mt-0.5 leading-relaxed">{successMsg}</p>
				</div>
			</div>
		{/if}

		<!-- Intro Description Card -->
		<div class="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
			<div class="space-y-1">
				<h2 class="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
					<Info class="size-4 text-slate-400" />
					关于域名等效规则
				</h2>
				<p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-3xl">
					等效规则允许将不同的域名或主机名组合在一起。
					当您登录属于同一规则下的任何域名时，Edgewarden 会认为它们是等效的，并自动推荐您的账户凭据。
					例如，将 <code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[10px] text-primary">apple.com</code> 和 <code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[10px] text-primary">icloud.com</code> 设为等效。
				</p>
			</div>
		</div>

		{#if loading}
			<!-- Skeleton Loader -->
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{#each Array(2) as _}
					<div class="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm animate-pulse">
						<div class="h-6 w-40 bg-slate-200 dark:bg-slate-800 rounded"></div>
						<div class="space-y-3">
							<div class="h-10 bg-slate-100 dark:bg-slate-850 rounded"></div>
							<div class="h-10 bg-slate-100 dark:bg-slate-850 rounded"></div>
							<div class="h-10 bg-slate-100 dark:bg-slate-850 rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
				
				<!-- LEFT: Custom Equivalent Domains -->
				<section class="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col gap-5 min-h-[500px]">
					<div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-850 pb-4 shrink-0">
						<div>
							<h3 class="font-bold text-slate-850 dark:text-slate-100 text-sm">自定义规则</h3>
							<p class="text-xs text-slate-450 dark:text-slate-500 mt-0.5">创建专属您的等效域名绑定</p>
						</div>
						<Button size="sm" onclick={handleAddCustomRule} disabled={newRuleDomains !== null} class="gap-1 bg-primary text-primary-foreground">
							<Plus class="size-3.5" />
							新增规则
						</Button>
					</div>

					<!-- Form to Add/Edit Rules inline -->
					{#if newRuleDomains !== null || editingRuleId !== null}
						{@const isNew = newRuleDomains !== null}
						{@const currentFields = isNew ? newRuleDomains! : editingDomains}
						{@const currentInvalids = isNew ? newRuleInvalidIndexes : editingInvalidIndexes}
						
						<div class="p-4 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 dark:bg-primary/10/5 flex flex-col gap-3.5 animate-in fade-in duration-200">
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold text-primary flex items-center gap-1.5">
									<Globe class="size-3.5" />
									{isNew ? "新建域名等效规则" : "编辑等效规则"}
								</span>
								<div class="flex gap-2">
									<Button size="sm" variant="ghost" onclick={() => isNew ? (newRuleDomains = null) : (editingRuleId = null)} class="h-7 text-slate-500 hover:bg-slate-150">
										取消
									</Button>
									<Button size="sm" onclick={isNew ? handleConfirmNewRule : handleConfirmEditRule} class="h-7 bg-primary text-primary-foreground font-medium">
										确认
									</Button>
								</div>
							</div>

							<div class="space-y-2">
								{#each currentFields as domain, idx}
									<div class="flex items-center gap-2">
										<Input
											placeholder="例如: google.com"
											bind:value={currentFields[idx]}
											class="h-9 {currentInvalids.has(idx) ? 'border-red-500 focus-visible:ring-red-400' : ''}"
										/>
										{#if currentFields.length > 2}
											<Button
												variant="ghost" size="icon"
												onclick={() => handleRemoveDomainField(isNew, idx)}
												class="size-9 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 shrink-0"
											>
												<Trash2 class="size-4" />
											</Button>
										{/if}
									</div>
								{/each}
							</div>

							<Button variant="outline" size="sm" onclick={() => handleAddDomainField(isNew)} class="gap-1.5 h-8 border-dashed border-primary/20 text-primary w-full hover:bg-primary/5">
								<Plus class="size-3.5" />
								添加等效域名
							</Button>
						</div>
					{/if}

					<!-- Custom Rules Table -->
					<div class="flex-1 space-y-3 overflow-y-auto max-h-[480px] pr-1">
						{#each customRules as rule, ruleIdx}
							<div class="p-4 rounded-xl border border-slate-150 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-between gap-4 transition-all duration-200 hover:border-slate-300 dark:hover:border-slate-700
								{rule.excluded ? 'opacity-60 grayscale-[40%]' : ''}">
								<div class="flex items-center gap-3 min-w-0 flex-1">
									<button
										onclick={() => handleToggleCustomRule(ruleIdx)}
										class="text-slate-400 hover:text-primary transition-colors shrink-0"
										title={rule.excluded ? "已禁用 (点击启用)" : "已启用 (点击禁用)"}
									>
										{#if rule.excluded}
											<Square class="size-4 text-slate-350" />
										{:else}
											<CheckSquare class="size-4 text-primary" />
										{/if}
									</button>

									<div class="min-w-0 flex-1 flex flex-wrap gap-1.5">
										{#each rule.domains as domain}
											<span class="px-2 py-0.5 bg-white dark:bg-slate-800 text-[11px] font-mono border border-slate-200 dark:border-slate-700 rounded-md font-semibold text-slate-750 dark:text-slate-200 select-all">
												{domain}
											</span>
										{/each}
									</div>
								</div>

								<div class="flex items-center gap-1 shrink-0">
									<Button variant="ghost" size="icon" onclick={() => handleStartEditRule(rule)} class="size-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
										<Edit class="size-3.5" />
									</Button>
									<Button variant="ghost" size="icon" onclick={() => handleDeleteCustomRule(ruleIdx)} class="size-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500">
										<Trash2 class="size-3.5" />
									</Button>
								</div>
							</div>
						{/each}

						{#if customRules.length === 0}
							<div class="flex flex-col items-center justify-center p-12 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/20 dark:bg-slate-900/10 h-full">
								<Globe class="size-10 text-slate-300 dark:text-slate-800 mb-3" />
								<span class="text-xs font-medium">暂无自定义等效规则</span>
								<span class="text-[10px] text-slate-500 mt-1">点击右上角“新增规则”来定义。</span>
							</div>
						{/if}
					</div>
				</section>

				<!-- RIGHT: Global Predefined Domains -->
				<section class="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col gap-5 min-h-[500px]">
					<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-850 pb-4 shrink-0">
						<div>
							<h3 class="font-bold text-slate-850 dark:text-slate-100 text-sm">全局等效规则</h3>
							<p class="text-xs text-slate-450 dark:text-slate-500 mt-0.5">Bitwarden 标准全局等效域名表</p>
						</div>

						<div class="relative w-full md:w-48">
							<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
							<Input
								type="search"
								placeholder="搜索全局域名..."
								bind:value={searchQuery}
								class="pl-[34px] h-[34px] text-xs"
							/>
						</div>
					</div>

					<div class="flex-1 space-y-3 overflow-y-auto max-h-[480px] pr-1">
						{#each filteredGlobals as rule}
							{@const isExcluded = excludedTypes.has(rule.type)}
							<div class="p-4 rounded-xl border border-slate-150 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-between gap-4 transition-all duration-200 hover:border-slate-300 dark:hover:border-slate-700
								{isExcluded ? 'opacity-50 grayscale-[40%]' : ''}">
								<div class="flex items-center gap-3 min-w-0 flex-1">
									<button
										onclick={() => handleToggleGlobalRule(rule.type)}
										class="text-slate-400 hover:text-primary transition-colors shrink-0"
										title={isExcluded ? "已排除该规则 (点击启用)" : "已包含该规则 (点击排除)"}
									>
										{#if isExcluded}
											<Square class="size-4 text-slate-350" />
										{:else}
											<CheckSquare class="size-4 text-primary" />
										{/if}
									</button>

									<div class="min-w-0 flex-1 flex flex-wrap gap-1.5">
										{#each rule.domains as domain}
											<span class="px-2 py-0.5 bg-white dark:bg-slate-800 text-[11px] font-mono border border-slate-200 dark:border-slate-700 rounded-md font-semibold text-slate-750 dark:text-slate-200">
												{domain}
											</span>
										{/each}
									</div>
								</div>

								<div class="shrink-0 flex items-center">
									{#if isExcluded}
										<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-200 dark:bg-slate-850 text-slate-500 border border-slate-300 dark:border-slate-750">
											已排除
										</span>
									{:else}
										<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">
											已启用
										</span>
									{/if}
								</div>
							</div>
						{/each}

						{#if filteredGlobals.length === 0}
							<div class="flex flex-col items-center justify-center p-12 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/20 dark:bg-slate-900/10 h-full">
								<Search class="size-8 text-slate-300 dark:text-slate-800 mb-2" />
								<span class="text-xs">未找到匹配的全局规则</span>
							</div>
						{/if}
					</div>
				</section>
				
			</div>
		{/if}
	</main>
</div>
