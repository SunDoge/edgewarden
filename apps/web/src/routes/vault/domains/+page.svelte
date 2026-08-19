<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { fetchDomainRules, updateDomainRules } from "$lib/services/api-vault";
import { Button } from "$lib/components/ui/button/index.js";
import * as Alert from "$lib/components/ui/alert/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import CustomEquivalentDomains from "$lib/components/domains/CustomEquivalentDomains.svelte";
import { normalizeEquivalentDomainRule } from "$lib/services/equivalent-domains";
import GlobalEquivalentDomains from "$lib/components/domains/GlobalEquivalentDomains.svelte";
import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
import { errorMessage } from "$lib/services/error-message";
import {
  ArrowLeft,
  Save,
  Globe,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  Info,
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

onMount(async () => {
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
  } catch (caught) {
    error = errorMessage(caught, "加载域名规则失败，请稍后重试。");
  } finally {
    loading = false;
  }
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
  } catch (caught) {
    error = errorMessage(caught, "保存规则失败，请稍后重试。");
  } finally {
    saving = false;
  }
}

// Helpers for notifications
let notificationTimeout: ReturnType<typeof setTimeout> | undefined;
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

<VaultPageShell title="域名等效规则" description="管理自动填充时视为同一站点的域名组合。">
	{#snippet actions()}
			<Button
				variant="outline"
				size="sm"
				onclick={loadRules}
				disabled={loading || saving}
			>
				{#if loading}<Spinner data-icon="inline-start" />{:else}<RefreshCw data-icon="inline-start" />{/if}
				<span class="hidden sm:inline">同步刷新</span>
			</Button>
			<Button
				onclick={handleSave}
				disabled={loading || saving}
				class="font-semibold"
			>
				{#if saving}<Spinner data-icon="inline-start" />{:else}<Save data-icon="inline-start" />{/if}
				{saving ? "保存中..." : "保存"}<span class="hidden sm:inline">并应用</span>
			</Button>
	{/snippet}
		<!-- Notification Alerts -->
		{#if error}
			<Alert.Root variant="destructive"><AlertCircle /><Alert.Title>操作提示</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>
		{/if}

		{#if successMsg}
			<Alert.Root><ShieldCheck /><Alert.Title>成功</Alert.Title><Alert.Description>{successMsg}</Alert.Description></Alert.Root>
		{/if}

		<!-- Intro Description Card -->
		<Alert.Root>
			<Info />
			<Alert.Title>关于域名等效规则</Alert.Title>
			<Alert.Description class="max-w-3xl leading-relaxed">
					等效规则允许将不同的域名或主机名组合在一起。
					当您登录属于同一规则下的任何域名时，Edgewarden 会认为它们是等效的，并自动推荐您的账户凭据。
					例如，将 <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">apple.com</code> 和 <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">icloud.com</code> 设为等效。
			</Alert.Description>
		</Alert.Root>

		{#if loading}
			<!-- Skeleton Loader -->
			<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
				{#each Array(2) as _}
					<Card.Root><Card.Header><Skeleton class="h-6 w-40" /><Skeleton class="h-4 w-64 max-w-full" /></Card.Header><Card.Content class="flex flex-col gap-3">{#each Array(3) as _}<Skeleton class="h-10 w-full" />{/each}</Card.Content></Card.Root>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
				
				<CustomEquivalentDomains bind:rules={customRules} onSuccess={showTimedSuccess} onError={showTimedError} />

				<GlobalEquivalentDomains rules={globalRules} bind:excludedTypes />
				
			</div>
		{/if}
</VaultPageShell>
