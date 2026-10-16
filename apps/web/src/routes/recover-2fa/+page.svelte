<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { goto } from "$app/navigation";
  import { recoverTwoFactorApi } from "$lib/services/api-auth";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { KeyRound, ShieldAlert } from "@lucide/svelte";

  let email = $state("");
  let password = $state("");
  let recoveryCode = $state("");
  let loading = $state(false);
  let error = $state("");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    loading = true;
    error = "";
    try {
      await recoverTwoFactorApi(email, password, recoveryCode);
      await goto("/login?recovered=1");
    } catch (value) {
      error =
        value instanceof Error
          ? value.message
          : m.ui_recovery_failed_check_your_credentials_and_recovery_code();
    } finally {
      password = "";
      loading = false;
    }
  }
</script>

<svelte:head><title>{m.ui_recover_two_step_login_edgewarden()}</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
  <Card.Root class="w-full max-w-md">
    <Card.Header
      ><div
        class="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"
      >
        <KeyRound />
      </div>
      <Card.Title>{m.ui_recover_two_step_login()}</Card.Title><Card.Description
        >{m.ui_use_your_master_password_and_one_time_recovery_code_to_turn_off_two_step_login_a()}</Card.Description
      ></Card.Header
    >
    <Card.Content>
      {#if error}<Alert.Root variant="destructive" class="mb-4"
          ><ShieldAlert /><Alert.Title>{m.ui_recovery_failed()}</Alert.Title><Alert.Description
            >{error}</Alert.Description
          ></Alert.Root
        >{/if}
      <form onsubmit={submit}>
        <Field.Group>
          <Field.Field
            ><Field.Label for="recover-email">{m.ui_email()}</Field.Label><Input
              id="recover-email"
              type="email"
              bind:value={email}
              autocomplete="email"
              required
            /></Field.Field
          >
          <Field.Field
            ><Field.Label for="recover-password">{m.login_master_password()}</Field.Label><Input
              id="recover-password"
              type="password"
              bind:value={password}
              autocomplete="current-password"
              required
            /></Field.Field
          >
          <Field.Field
            ><Field.Label for="recover-code">{m.login_recovery_code()}</Field.Label><Input
              id="recover-code"
              bind:value={recoveryCode}
              autocomplete="one-time-code"
              autocapitalize="characters"
              maxlength={64}
              required
            /></Field.Field
          >
          <Button
            class="w-full"
            type="submit"
            disabled={loading || !email || !password || recoveryCode.length < 8}
            >{#if loading}<Spinner
                data-icon="inline-start"
              />{m.ui_recovering()}{:else}{m.ui_turn_off_two_step_login()}{/if}</Button
          >
        </Field.Group>
      </form>
    </Card.Content>
    <Card.Footer
      ><Button variant="link" class="px-0" onclick={() => goto("/login")}
        >{m.ui_back_to_login()}</Button
      ></Card.Footer
    >
  </Card.Root>
</main>
