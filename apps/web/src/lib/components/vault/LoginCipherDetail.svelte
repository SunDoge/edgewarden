<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Check, Copy, ExternalLink, Eye, EyeOff } from "@lucide/svelte";
  import type { VaultLoginData, VaultTotp } from "$lib/services/vault-types";

  let {
    login,
    hidePasswords = false,
    totp,
  }: {
    login: VaultLoginData | null;
    hidePasswords?: boolean;
    totp: VaultTotp | null;
  } = $props();

  let copiedField = $state<string | null>(null);
  let showPassword = $state(false);
  let uris = $derived(
    Array.isArray(login?.uris) ? login.uris : login?.uri ? [{ uri: login.uri }] : [],
  );

  function copy(text: string, field: string) {
    void navigator.clipboard.writeText(text);
    copiedField = field;
    setTimeout(() => {
      if (copiedField === field) copiedField = null;
    }, 2000);
  }
</script>

<Field.Group>
  {#if login?.username}
    <Field.Field>
      <Field.Label>用户名</Field.Label>
      <div class="flex items-center justify-between rounded-lg border bg-background p-2">
        <span class="truncate pr-2 text-sm font-medium select-all">{login.username}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={() => copy(login.username ?? "", "username")}
          aria-label="复制用户名"
          >{#if copiedField === "username"}<Check class="text-primary" />{:else}<Copy
            />{/if}</Button
        >
      </div>
    </Field.Field>
  {/if}

  {#if login?.password}
    <Field.Field>
      <Field.Label>密码</Field.Label>
      <div class="flex items-center justify-between rounded-lg border bg-background p-2">
        <span class="truncate pr-2 font-mono text-sm select-all"
          >{showPassword && !hidePasswords ? login.password : "••••••••••••"}</span
        >
        {#if !hidePasswords}<div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={() => (showPassword = !showPassword)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >{#if showPassword}<EyeOff />{:else}<Eye />{/if}</Button
            >
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={() => copy(login.password ?? "", "password")}
              aria-label="复制密码"
              >{#if copiedField === "password"}<Check class="text-primary" />{:else}<Copy
                />{/if}</Button
            >
          </div>{/if}
      </div>
    </Field.Field>
  {/if}

  {#if login?.totp && !hidePasswords}
    <Field.Field>
      <Field.Label>单次有效密码 (TOTP)</Field.Label>
      <div class="flex items-center justify-between rounded-lg border bg-background p-2">
        {#if totp}<div class="flex items-center gap-2">
            <span class="font-mono text-sm font-bold tracking-wider text-primary select-all"
              >{totp.code.slice(0, 3)} {totp.code.slice(3)}</span
            ><span class="text-xs text-muted-foreground">({totp.remain}s)</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0"
            onclick={() => copy(totp?.code || "", "totp")}
            aria-label="复制动态密码"
            >{#if copiedField === "totp"}<Check class="text-primary" />{:else}<Copy />{/if}</Button
          >{:else}<span class="text-xs text-muted-foreground">正在计算...</span>{/if}
      </div>
    </Field.Field>
  {/if}

  {#if uris.length > 0}
    <Field.Field>
      <Field.Label>{uris.length > 1 ? "网页链接列表" : "网页链接"}</Field.Label>
      <div class="flex flex-col gap-2">
        {#each uris as uriItem, index}
          {#if uriItem.uri}<div
              class="flex items-center justify-between rounded-lg border bg-background p-2"
            >
              <a
                href={uriItem.uri}
                target="_blank"
                rel="noopener noreferrer"
                class="flex truncate pr-2 text-sm font-medium text-primary hover:underline"
                >{uriItem.uri}<ExternalLink class="size-3 shrink-0" /></a
              ><Button
                variant="ghost"
                size="icon-sm"
                class="shrink-0"
                onclick={() => copy(uriItem.uri ?? "", `uri-${index}`)}
                aria-label="复制网页链接"
                >{#if copiedField === `uri-${index}`}<Check class="text-primary" />{:else}<Copy
                  />{/if}</Button
              >
            </div>{/if}
        {/each}
      </div>
    </Field.Field>
  {/if}
</Field.Group>
