<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import TotpCountdown from "$lib/components/vault/TotpCountdown.svelte";
  import { calcTotpNow } from "$lib/services/crypto";
  import { vault } from "$lib/stores/vault.svelte";
  import { ArrowLeft, Check, Copy, KeyRound } from "@lucide/svelte";

  let codes = $state<Record<string, { code: string; remain: number; period: number } | null>>({});
  let copiedId = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let items = $derived(
    vault.ciphers
      .filter((cipher) => !cipher.deletedDate && cipher.type === 1 && cipher.login?.totp)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  async function refreshCodes() {
    const entries = await Promise.all(
      items.map(async (cipher) => {
        try {
          return [cipher.id, await calcTotpNow(String(cipher.login?.totp ?? ""))] as const;
        } catch {
          return [cipher.id, null] as const;
        }
      }),
    );
    codes = Object.fromEntries(entries);
  }

  async function copyCode(id: string, value: string) {
    await navigator.clipboard.writeText(value);
    copiedId = id;
    setTimeout(() => {
      if (copiedId === id) copiedId = null;
    }, 1500);
  }

  onMount(() => {
    void refreshCodes();
    timer = setInterval(() => void refreshCodes(), 1000);
    return () => {
      if (timer) clearInterval(timer);
    };
  });
</script>

<svelte:head><title>{m.ui_verification_codes_edgewarden()}</title></svelte:head>

<VaultPageShell
  title={m.nav_totp()}
  description={m.ui_codes_are_generated_on_your_device_using_the_totp_keys_in_your_vault()}
  width="default"
>
  {#if vault.isSyncing && !items.length}<Empty.Root
      ><Empty.Media variant="icon"><Spinner /></Empty.Media><Empty.Header
        ><Empty.Title>{m.ui_loading_verification_codes()}</Empty.Title></Empty.Header
      ></Empty.Root
    >
  {:else if !items.length}<Empty.Root
      ><Empty.Media variant="icon"><KeyRound /></Empty.Media><Empty.Header
        ><Empty.Title>{m.ui_no_logins_with_totp_keys()}</Empty.Title><Empty.Description
          >{m.ui_add_a_totp_key_to_a_login_item_to_see_its_code_here()}</Empty.Description
        ></Empty.Header
      ></Empty.Root
    >
  {:else}<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each items as item (item.id)}
        {@const live = codes[item.id]}
        <Card.Root
          ><Card.Header class="pb-3"
            ><Card.Title class="truncate">{item.name}</Card.Title><Card.Description class="truncate"
              >{item.login?.username || m.ui_no_username()}</Card.Description
            ></Card.Header
          ><Card.Content
            ><div class="flex items-center justify-between gap-3">
              <div>
                <p class="font-mono text-2xl font-bold tracking-widest">
                  {live ? `${live.code.slice(0, 3)} ${live.code.slice(3)}` : "——— ———"}
                </p>
                <p class="text-xs text-muted-foreground">
                  {live ? m.ui_verification_code() : m.ui_unable_to_generate_code()}
                </p>
              </div>
              <div class="flex items-center gap-2">
                {#if live}<TotpCountdown remain={live.remain} period={live.period} />{/if}<Button
                  variant="outline"
                  size="icon"
                  disabled={!live}
                  onclick={() => live && copyCode(item.id, live.code)}
                  aria-label={m.ui_copy_verification_code_for_value({ value0: item.name })}
                  >{#if copiedId === item.id}<Check />{:else}<Copy />{/if}</Button
                >
              </div>
            </div></Card.Content
          ></Card.Root
        >
      {/each}
    </div>{/if}
</VaultPageShell>
