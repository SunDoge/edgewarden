<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

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
  import type { CustomEquivalentDomain, GlobalEquivalentDomain } from "@edgewarden/shared";

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
      error = errorMessage(caught, m.ui_unable_to_load_domain_rules_please_try_again_later());
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
        updated.globalEquivalentDomains.filter((g) => g.excluded).map((g) => g.type),
      );

      showTimedSuccess(m.ui_equivalent_domain_rules_saved_and_applied());
    } catch (caught) {
      error = errorMessage(caught, m.ui_unable_to_save_rules_please_try_again_later());
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
  <title>{m.ui_equivalent_domains_edgewarden()}</title>
</svelte:head>

<VaultPageShell
  title={m.nav_domains()}
  description={m.ui_manage_domains_treated_as_the_same_site_for_autofill()}
>
  {#snippet actions()}
    <Button variant="outline" size="sm" onclick={loadRules} disabled={loading || saving}>
      {#if loading}<Spinner data-icon="inline-start" />{:else}<RefreshCw
          data-icon="inline-start"
        />{/if}
      <span class="hidden sm:inline">{m.ui_sync_and_refresh()}</span>
    </Button>
    <Button onclick={handleSave} disabled={loading || saving} class="font-semibold">
      {#if saving}<Spinner data-icon="inline-start" />{:else}<Save data-icon="inline-start" />{/if}
      {saving ? m.ui_saving() : m.domains_save_and_apply()}
    </Button>
  {/snippet}
  <!-- Notification Alerts -->
  {#if error}
    <Alert.Root variant="destructive"
      ><AlertCircle /><Alert.Title>{m.ui_notice()}</Alert.Title><Alert.Description
        >{error}</Alert.Description
      ></Alert.Root
    >
  {/if}

  {#if successMsg}
    <Alert.Root
      ><ShieldCheck /><Alert.Title>{m.ui_success()}</Alert.Title><Alert.Description
        >{successMsg}</Alert.Description
      ></Alert.Root
    >
  {/if}

  <!-- Intro Description Card -->
  <Alert.Root>
    <Info />
    <Alert.Title>{m.ui_about_equivalent_domains()}</Alert.Title>
    <Alert.Description class="max-w-3xl leading-relaxed"
      >{m.domains_explanation({ first: "apple.com", second: "icloud.com" })}</Alert.Description
    >
  </Alert.Root>

  {#if loading}
    <!-- Skeleton Loader -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {#each Array(2) as _}
        <Card.Root
          ><Card.Header
            ><Skeleton class="h-6 w-40" /><Skeleton class="h-4 w-64 max-w-full" /></Card.Header
          ><Card.Content class="flex flex-col gap-3"
            >{#each Array(3) as _}<Skeleton class="h-10 w-full" />{/each}</Card.Content
          ></Card.Root
        >
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <CustomEquivalentDomains
        bind:rules={customRules}
        onSuccess={showTimedSuccess}
        onError={showTimedError}
      />

      <GlobalEquivalentDomains rules={globalRules} bind:excludedTypes />
    </div>
  {/if}
</VaultPageShell>
