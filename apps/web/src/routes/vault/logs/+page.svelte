<script lang="ts">
  import { formatDateTime } from "$lib/i18n/format";
  import * as m from "$lib/paraglide/messages.js";

  import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, ShieldAlert } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import {
    fetchAuditLogSettingsApi,
    listAuditLogsApi,
    updateAuditLogSettingsApi,
  } from "$lib/services/api-admin";
  import { vault } from "$lib/stores/vault.svelte";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import type { AuditLogEntry } from "$lib/services/admin-types";

  let logs = $state<AuditLogEntry[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let category = $state("all");
  let level = $state("all");
  let query = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let retentionMode = $state<"days" | "entries">("days");
  let retentionDays = $state("0");
  let maxEntries = $state(10000);
  const limit = 50;

  async function load(reset = false) {
    if (reset) offset = 0;
    busy = true;
    error = null;
    try {
      const result = await listAuditLogsApi({
        limit,
        offset,
        category: category === "all" ? undefined : category,
        level: level === "all" ? undefined : level,
        q: query.trim(),
      });
      logs = result.data;
      total = result.total;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      busy = false;
    }
  }

  async function loadSettings() {
    const settings = await fetchAuditLogSettingsApi();
    retentionMode = settings.maxEntries ? "entries" : "days";
    retentionDays = String(settings.retentionDays ?? 0);
    maxEntries = settings.maxEntries ?? 10000;
  }

  async function saveSettings() {
    busy = true;
    error = null;
    try {
      await updateAuditLogSettingsApi(
        retentionMode === "days"
          ? {
              retentionDays: (Number(retentionDays) as 7 | 30 | 90 | 180 | 365) || null,
              maxEntries: null,
            }
          : { retentionDays: null, maxEntries },
      );
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    if (vault.profile?.role !== "admin") void goto("/vault");
    else void Promise.all([load(), loadSettings()]);
  });
</script>

<svelte:head><title>{m.ui_audit_log_edgewarden()}</title></svelte:head>

<VaultPageShell
  title={m.nav_logs()}
  description={m.ui_login_security_and_administrative_events_keys_and_passwords_are_removed_from_met()}
  width="full"
>
  {#snippet actions()}<Button variant="outline" onclick={() => load()} disabled={busy}
      ><RefreshCw data-icon="inline-start" />{m.ui_refresh()}</Button
    >{/snippet}
  {#if error}<Alert.Root variant="destructive"
      ><ShieldAlert /><Alert.Title>{m.ui_audit_log_action_failed()}</Alert.Title><Alert.Description
        >{error}</Alert.Description
      ></Alert.Root
    >{/if}
  <form
    class="grid items-end gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap"
    onsubmit={(event) => {
      event.preventDefault();
      void load(true);
    }}
  >
    <Field.Field class="min-w-0 flex-1 sm:col-span-2"
      ><Field.Label for="log-query">{m.ui_search()}</Field.Label><Input
        id="log-query"
        bind:value={query}
        placeholder={m.ui_action_email_or_metadata()}
      /></Field.Field
    ><Field.Field
      ><Field.Label>{m.ui_category()}</Field.Label><Select.Root type="single" bind:value={category}
        ><Select.Trigger class="w-full lg:w-36"
          >{category === "all" ? m.ui_all() : category}</Select.Trigger
        ><Select.Content
          ><Select.Group
            ><Select.Item value="all">{m.ui_all()}</Select.Item><Select.Item value="auth"
              >auth</Select.Item
            ><Select.Item value="vault">vault</Select.Item><Select.Item value="admin"
              >admin</Select.Item
            ><Select.Item value="system">system</Select.Item><Select.Item value="org"
              >org</Select.Item
            ></Select.Group
          ></Select.Content
        ></Select.Root
      ></Field.Field
    ><Field.Field
      ><Field.Label>{m.ui_level()}</Field.Label><Select.Root type="single" bind:value={level}
        ><Select.Trigger class="w-full lg:w-36"
          >{level === "all" ? m.ui_all() : level}</Select.Trigger
        ><Select.Content
          ><Select.Group
            ><Select.Item value="all">{m.ui_all()}</Select.Item><Select.Item value="info"
              >info</Select.Item
            ><Select.Item value="warning">warning</Select.Item><Select.Item value="error"
              >error</Select.Item
            ></Select.Group
          ></Select.Content
        ></Select.Root
      ></Field.Field
    ><Button type="submit" disabled={busy}>{m.ui_search_2()}</Button>
  </form>
  <section class="min-w-0 rounded-lg border bg-card">
    <div class="overflow-x-auto">
      <Table.Root
        ><Table.Caption>{m.ui_records_value({ value0: total })}</Table.Caption><Table.Header
          ><Table.Row
            ><Table.Head>{m.ui_time()}</Table.Head><Table.Head>{m.ui_level()}</Table.Head
            ><Table.Head>{m.ui_category_action()}</Table.Head><Table.Head>{m.ui_actor()}</Table.Head
            ><Table.Head>{m.ui_target()}</Table.Head><Table.Head>{m.ui_metadata()}</Table.Head
            ></Table.Row
          ></Table.Header
        ><Table.Body
          >{#each logs as log (log.id)}<Table.Row
              ><Table.Cell class="whitespace-nowrap text-xs"
                >{formatDateTime(log.createdAt)}</Table.Cell
              ><Table.Cell
                ><Badge variant={log.level === "error" ? "destructive" : "outline"}
                  >{log.level}</Badge
                ></Table.Cell
              ><Table.Cell
                ><p class="text-xs text-muted-foreground">{log.category}</p>
                <p class="font-medium">{log.action}</p></Table.Cell
              ><Table.Cell>{log.actorEmail || m.ui_system()}</Table.Cell><Table.Cell
                >{[log.targetType, log.targetId].filter(Boolean).join(": ") || "—"}</Table.Cell
              ><Table.Cell
                ><code class="break-all text-xs">{JSON.stringify(log.metadata)}</code></Table.Cell
              ></Table.Row
            >{/each}</Table.Body
        ></Table.Root
      >
    </div>
    {#if !logs.length && !busy}<p class="p-8 text-center text-sm text-muted-foreground">
        {m.ui_no_matching_log_entries()}
      </p>{/if}
    <footer class="flex flex-wrap items-center justify-end gap-2 border-t p-3">
      <Button
        variant="outline"
        size="sm"
        disabled={offset === 0 || busy}
        onclick={() => {
          offset = Math.max(0, offset - limit);
          void load();
        }}><ChevronLeft data-icon="inline-start" />{m.ui_previous()}</Button
      ><span class="text-xs text-muted-foreground"
        >{total ? `${offset + 1}–${Math.min(total, offset + limit)} / ${total}` : "0 / 0"}</span
      ><Button
        variant="outline"
        size="sm"
        disabled={offset + limit >= total || busy}
        onclick={() => {
          offset += limit;
          void load();
        }}>{m.ui_next()}<ChevronRight data-icon="inline-end" /></Button
      >
    </footer>
  </section>
  <section class="rounded-lg border bg-card p-4">
    <Field.Group
      ><Field.Field
        ><Field.Label>{m.ui_retention_policy()}</Field.Label><Field.Description
          >{m.ui_logs_are_kept_indefinitely_by_default_with_no_clear_all_action_set_a_retention_l()}</Field.Description
        ><Select.Root type="single" bind:value={retentionMode}
          ><Select.Trigger
            >{retentionMode === "days" ? m.ui_by_age() : m.ui_by_record_count()}</Select.Trigger
          ><Select.Content
            ><Select.Item value="days">{m.ui_by_age()}</Select.Item><Select.Item value="entries"
              >{m.ui_by_record_count()}</Select.Item
            ></Select.Content
          ></Select.Root
        ></Field.Field
      >{#if retentionMode === "days"}<Field.Field
          ><Field.Label>{m.ui_days_to_keep()}</Field.Label><Select.Root
            type="single"
            bind:value={retentionDays}
            ><Select.Trigger
              >{retentionDays === "0"
                ? m.ui_forever()
                : m.ui_value_days({ value0: retentionDays })}</Select.Trigger
            ><Select.Content
              >{#each ["0", "7", "30", "90", "180", "365"] as days}<Select.Item value={days}
                  >{days === "0" ? m.ui_forever() : m.ui_value_days({ value0: days })}</Select.Item
                >{/each}</Select.Content
            ></Select.Root
          ></Field.Field
        >{:else}<Field.Field
          ><Field.Label for="max-log-entries">{m.ui_maximum_records()}</Field.Label><Input
            id="max-log-entries"
            type="number"
            min={100}
            max={1000000}
            bind:value={maxEntries}
          /></Field.Field
        >{/if}<Field.Field orientation="horizontal"
        ><Button onclick={saveSettings} disabled={busy}>{m.ui_save_retention_policy()}</Button
        ></Field.Field
      ></Field.Group
    >
  </section>
</VaultPageShell>
