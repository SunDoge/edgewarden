<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

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
      newRuleDomains = newRuleDomains.filter((_, itemIndex) => itemIndex !== index);
      newRuleInvalidIndexes = new Set();
    } else if (!isNew && editingDomains.length > 2) {
      editingDomains = editingDomains.filter((_, itemIndex) => itemIndex !== index);
      editingInvalidIndexes = new Set();
    }
  }

  function validate(domains: string[], isNew: boolean) {
    const normalized = normalizeEquivalentDomainRule(domains);
    if (isNew) newRuleInvalidIndexes = normalized.invalidIndexes;
    else editingInvalidIndexes = normalized.invalidIndexes;
    if (normalized.invalidIndexes.size) {
      onError(m.ui_some_domains_are_invalid_correct_the_highlighted_entries());
      return null;
    }
    if (!normalized.valid) {
      onError(m.ui_each_rule_must_contain_at_least_2_valid_domains());
      return null;
    }
    return normalized.domains;
  }

  function confirmNew() {
    if (!newRuleDomains) return;
    const domains = validate(newRuleDomains, true);
    if (!domains) return;
    rules = [{ id: createEquivalentDomainRuleId(), domains, excluded: false }, ...rules];
    newRuleDomains = null;
    newRuleInvalidIndexes = new Set();
    onSuccess(m.ui_rule_added_locally_select_save_and_apply_to_save_your_changes());
  }

  function confirmEdit() {
    const domains = validate(editingDomains, false);
    if (!domains) return;
    rules = rules.map((rule) => (rule.id === editingRuleId ? { ...rule, domains } : rule));
    editingRuleId = null;
    editingDomains = ["", ""];
    editingInvalidIndexes = new Set();
    onSuccess(m.ui_rule_updated_locally_select_save_and_apply_to_save_your_changes());
  }

  function toggleRule(index: number) {
    rules = rules.map((rule, ruleIndex) =>
      ruleIndex === index ? { ...rule, excluded: !rule.excluded } : rule,
    );
  }

  function deleteRule(index: number) {
    rules = rules.filter((_, ruleIndex) => ruleIndex !== index);
    onSuccess(m.ui_rule_removed_locally_select_save_and_apply_to_save_your_changes());
  }
</script>

<Card.Root class="min-h-[500px] min-w-0">
  <Card.Header>
    <Card.Title>{m.ui_custom_rules()}</Card.Title>
    <Card.Description>{m.ui_define_your_own_groups_of_equivalent_domains()}</Card.Description>
    <Card.Action
      ><Button size="sm" onclick={startAdd} disabled={newRuleDomains !== null}
        ><Plus data-icon="inline-start" />{m.ui_add_rule()}</Button
      ></Card.Action
    >
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    {#if newRuleDomains !== null || editingRuleId !== null}
      {@const isNew = newRuleDomains !== null}
      {@const currentFields = isNew ? newRuleDomains! : editingDomains}
      {@const currentInvalids = isNew ? newRuleInvalidIndexes : editingInvalidIndexes}
      <div class="flex flex-col gap-3 rounded-lg border border-dashed p-4">
        <div class="flex items-center justify-between gap-3">
          <p class="flex items-center gap-2 text-sm font-medium">
            <Globe />{isNew
              ? m.ui_new_equivalent_domain_rule()
              : m.ui_edit_equivalent_domain_rule()}
          </p>
          <div class="flex gap-2">
            <Button size="sm" variant="ghost" onclick={() => cancelEditor(isNew)}
              >{m.login_cancel()}</Button
            ><Button size="sm" onclick={isNew ? confirmNew : confirmEdit}>{m.ui_confirm()}</Button>
          </div>
        </div>
        <Field.Group
          >{#each currentFields as _, index}<Field.Field data-invalid={currentInvalids.has(index)}
              ><div class="flex gap-2">
                <Input
                  placeholder={m.ui_for_example_google_com()}
                  bind:value={currentFields[index]}
                  aria-invalid={currentInvalids.has(index)}
                  aria-label={m.ui_equivalent_domain_value({ value0: index + 1 })}
                />{#if currentFields.length > 2}<Button
                    variant="ghost"
                    size="icon"
                    onclick={() => removeDomain(isNew, index)}
                    aria-label={m.ui_remove_domain()}><Trash2 /></Button
                  >{/if}
              </div>
              {#if currentInvalids.has(index)}<Field.Error
                  >{m.ui_enter_a_valid_domain_2()}</Field.Error
                >{/if}</Field.Field
            >{/each}</Field.Group
        >
        <Button variant="outline" size="sm" onclick={() => addDomain(isNew)} class="w-full"
          ><Plus data-icon="inline-start" />{m.ui_add_equivalent_domain()}</Button
        >
      </div>
    {/if}

    <div class="flex max-h-[480px] flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {#each rules as rule, index (rule.id)}
        <div
          class={cn(
            "flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4",
            rule.excluded && "opacity-60",
          )}
        >
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <Checkbox
              checked={!rule.excluded}
              onCheckedChange={() => toggleRule(index)}
              aria-label={rule.excluded ? m.ui_enable_rule() : m.ui_disable_rule()}
            />
            <div class="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {#each rule.domains as domain}<code
                  class="rounded-md border bg-background px-2 py-0.5 text-xs font-semibold"
                  >{domain}</code
                >{/each}
            </div>
          </div>
          <div class="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              onclick={() => startEdit(rule)}
              aria-label={m.ui_edit_rule()}><Edit /></Button
            ><Button
              variant="ghost"
              size="icon"
              onclick={() => deleteRule(index)}
              aria-label={m.ui_delete_rule()}><Trash2 /></Button
            >
          </div>
        </div>
      {:else}
        <Empty.Root class="h-full border border-dashed"
          ><Empty.Header
            ><Empty.Media variant="icon"><Globe /></Empty.Media><Empty.Title
              >{m.ui_no_custom_rules_yet()}</Empty.Title
            ><Empty.Description
              >{m.ui_select_add_rule_to_define_a_group_of_equivalent_domains()}</Empty.Description
            ></Empty.Header
          ></Empty.Root
        >
      {/each}
    </div>
  </Card.Content>
</Card.Root>
