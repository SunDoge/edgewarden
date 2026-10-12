<script lang="ts">
  import { Languages } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { changeLocale } from "$lib/i18n/locale.svelte";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { m } from "$lib/paraglide/messages.js";
</script>

<Button
  type="button"
  variant="ghost"
  size="sm"
  aria-label={m.language_switch()}
  onclick={() => changeLocale(getLocale() === "en" ? "zh-CN" : "en")}
>
  <Languages />
  <span lang={getLocale() === "en" ? "zh-CN" : "en"}>
    {getLocale() === "en" ? "简体中文" : "English"}
  </span>
</Button>
