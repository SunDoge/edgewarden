<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { onMount } from "svelte";
  import { match } from "ts-pattern";
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { inspectPasswordHealth, type PasswordHealthReport } from "$lib/services/password-health";
  import { vault } from "$lib/stores/vault.svelte";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, ShieldAlert } from "@lucide/svelte";

  let report = $state<PasswordHealthReport | null>(null);
  let scanning = $state(false);
  let scanError = $state<string | null>(null);
  let controller: AbortController | null = null;
  let filter = $state<"all" | "exposed" | "reused" | "weak">("all");
  let progress = $state({ checked: 0, total: 0 });
  let revealed = $state<Set<string>>(new Set());
  let filteredItems = $derived(
    report?.items.filter((item) =>
      match(filter)
        .with("exposed", () => (item.exposedCount ?? 0) > 0)
        .with("reused", () => item.reusedCount > 1)
        .with("weak", () => item.weak)
        .otherwise(() => true),
    ) ?? [],
  );

  async function scan() {
    controller?.abort();
    controller = new AbortController();
    scanning = true;
    filter = "all";
    revealed = new Set();
    progress = {
      checked: 0,
      total: vault.ciphers.filter(
        (cipher) =>
          cipher.type === 1 &&
          !cipher.deletedDate &&
          !cipher.hidePasswords &&
          cipher.login?.password,
      ).length,
    };
    scanError = null;
    try {
      report = await inspectPasswordHealth(
        vault.ciphers,
        fetch,
        controller.signal,
        (checked, total) => (progress = { checked, total }),
      );
    } catch (error) {
      if (!controller.signal.aborted)
        scanError = error instanceof Error ? error.message : String(error);
    } finally {
      scanning = false;
    }
  }

  onMount(() => {
    return () => controller?.abort();
  });

  function toggleReveal(id: string) {
    const next = new Set(revealed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    revealed = next;
  }
</script>

<svelte:head><title>{m.ui_password_health_edgewarden()}</title></svelte:head>

<VaultPageShell
  title={m.nav_health()}
  description={m.ui_only_the_first_5_characters_of_each_sha_1_hash_are_sent_to_have_i_been_pwned_pas()}
  width="default"
>
  {#snippet actions()}<Button onclick={scan} disabled={scanning || vault.isSyncing}
      >{#if scanning}<Spinner data-icon="inline-start" />{:else}<ShieldAlert
          data-icon="inline-start"
        />{/if}{report ? m.ui_check_again() : m.ui_start_check()}</Button
    >{/snippet}
  {#if scanError}<Alert.Root variant="destructive"
      ><Alert.Title>{m.ui_check_failed()}</Alert.Title><Alert.Description
        >{scanError}</Alert.Description
      ></Alert.Root
    >{/if}
  {#if scanning}<Card.Root
      ><Card.Content class="flex flex-col gap-2 pt-6"
        ><div class="flex justify-between text-sm text-muted-foreground">
          <span>{m.ui_checking_passwords()}</span><span>{progress.checked} / {progress.total}</span>
        </div>
        <Progress value={progress.checked} max={Math.max(progress.total, 1)} /></Card.Content
      ></Card.Root
    >{/if}
  {#if report}<ToggleGroup.Root
      type="single"
      variant="outline"
      spacing={2}
      value={filter}
      onValueChange={(value) => {
        if (value) filter = value as typeof filter;
      }}
      class="grid w-full grid-cols-2 sm:grid-cols-4"
    >
      <ToggleGroup.Item value="exposed" class="h-auto flex-col items-start p-4"
        ><span class="text-2xl font-semibold text-destructive">{report.exposedCount}</span><span
          class="text-xs text-muted-foreground">{m.ui_exposed()}</span
        ></ToggleGroup.Item
      >
      <ToggleGroup.Item value="reused" class="h-auto flex-col items-start p-4"
        ><span class="text-2xl font-semibold">{report.reusedCount}</span><span
          class="text-xs text-muted-foreground">{m.ui_reused()}</span
        ></ToggleGroup.Item
      >
      <ToggleGroup.Item value="weak" class="h-auto flex-col items-start p-4"
        ><span class="text-2xl font-semibold">{report.weakCount}</span><span
          class="text-xs text-muted-foreground">{m.ui_weak_passwords()}</span
        ></ToggleGroup.Item
      >
      <ToggleGroup.Item value="all" class="h-auto flex-col items-start p-4"
        ><span class="text-2xl font-semibold">{report.eligibleCount}</span><span
          class="text-xs text-muted-foreground">{m.ui_checked()}</span
        ></ToggleGroup.Item
      >
    </ToggleGroup.Root>
    <div class="flex flex-col gap-2">
      {#each filteredItems as risk (risk.cipherId)}{@const cipher = vault.ciphers.find(
          (item) => item.id === risk.cipherId,
        )}<Card.Root
          ><Card.Content class="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap"
            ><Button
              variant="ghost"
              class="h-auto min-w-0 flex-1 justify-start p-1 text-left"
              onclick={() => goto(`/vault?cipher=${encodeURIComponent(risk.cipherId)}`)}
              ><span class="min-w-0"
                ><span class="block truncate font-semibold"
                  >{cipher?.name ?? m.ui_unknown_item()}</span
                ><span class="block truncate text-xs text-muted-foreground"
                  >{cipher?.login?.username ?? ""}</span
                ><span class="mt-1 block truncate font-mono text-xs"
                  >{revealed.has(risk.cipherId) ? cipher?.login?.password : "••••••••••••"}</span
                ></span
              ></Button
            ><Button
              variant="ghost"
              size="icon-sm"
              onclick={() => toggleReveal(risk.cipherId)}
              aria-label={m.ui_show_or_hide_password()}
              >{#if revealed.has(risk.cipherId)}<EyeOff data-icon />{:else}<Eye
                  data-icon
                />{/if}</Button
            >
            <div class="flex w-full flex-wrap gap-1 sm:w-auto sm:justify-end">
              {#if risk.exposedCount === null}<Badge variant="outline"
                  >{m.ui_lookup_unavailable()}</Badge
                >{:else if risk.exposedCount > 0}<Badge variant="destructive"
                  >{m.ui_exposures_value({ value0: risk.exposedCount })}</Badge
                >{/if}{#if risk.reusedCount > 1}<Badge variant="secondary"
                  >{m.ui_used_in_value_items({ value0: risk.reusedCount })}</Badge
                >{/if}{#if risk.weak}<Badge variant="secondary">{m.ui_weak_passwords()}</Badge>{/if}
            </div></Card.Content
          ></Card.Root
        >{/each}{#if !filteredItems.length}<Empty.Root
          ><Empty.Header
            ><Empty.Media variant="icon"><CheckCircle2 /></Empty.Media><Empty.Title
              >{m.ui_no_password_risks_found()}</Empty.Title
            ><Empty.Description
              >{m.ui_no_items_need_attention_with_the_current_filters()}</Empty.Description
            ></Empty.Header
          ></Empty.Root
        >{/if}
    </div>
  {:else if !scanning}<Empty.Root
      ><Empty.Header
        ><Empty.Media variant="icon"><AlertTriangle /></Empty.Media><Empty.Title
          >{m.ui_check_password_health()}</Empty.Title
        ><Empty.Description
          >{m.ui_hashes_are_calculated_in_your_browser_exposure_counts_are_looked_up_using_k_anon()}</Empty.Description
        ></Empty.Header
      ><Empty.Content
        ><Button onclick={scan}><ShieldAlert data-icon="inline-start" />{m.ui_start_check()}</Button
        ></Empty.Content
      ></Empty.Root
    >{/if}
</VaultPageShell>
