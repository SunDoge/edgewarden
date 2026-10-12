<script lang="ts">
  import LanguageSwitcher from "$lib/components/LanguageSwitcher.svelte";
  import { m } from "$lib/paraglide/messages.js";
  let value = $state("");
</script>

<LanguageSwitcher />
<label for="draft">{m.login_email()}</label>
<input id="draft" bind:value />
