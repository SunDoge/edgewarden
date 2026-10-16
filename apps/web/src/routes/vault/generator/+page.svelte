<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import VaultPageShell from "$lib/components/vault/VaultPageShell.svelte";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import {
    GENERATOR_SETTINGS_KEY,
    createGeneratorPreferences,
    parseGeneratorPreferences,
  } from "$lib/services/generator-preferences";
  import {
    estimateBits,
    generateEmailAlias,
    generatePassphrase,
    generatePassword,
    generatePin,
    generateUsername,
    type GeneratorMode,
  } from "$lib/services/password-generator";
  import { generateSshKey, type GeneratedSshKey } from "$lib/services/ssh-key-generator";
  import { ArrowLeft, Check, Copy, Download, RefreshCw } from "@lucide/svelte";
  import { match } from "ts-pattern";

  let preferences = $state(createGeneratorPreferences());
  let value = $state("");
  let error = $state("");
  let copied = $state(false);
  let sshKey = $state<GeneratedSshKey | null>(null);
  let generating = $state(false);
  let bits = $derived(estimateBits(value, preferences.mode));

  async function generate() {
    error = "";
    copied = false;
    generating = true;
    try {
      if (preferences.mode === "ssh") {
        sshKey = await generateSshKey({
          type: preferences.sshType,
          rsaLength: Number(preferences.rsaLength) as 2048 | 3072 | 4096,
          comment: preferences.sshComment,
        });
        value = sshKey.publicKey;
        return;
      }
      value = match(preferences.mode)
        .with("password", () =>
          generatePassword({
            length: preferences.length,
            uppercase: preferences.uppercase,
            lowercase: preferences.lowercase,
            numbers: preferences.numbers,
            special: preferences.special,
            avoidAmbiguous: preferences.avoidAmbiguous,
            minUppercase: preferences.minUppercase,
            minLowercase: preferences.minLowercase,
            minNumbers: preferences.minNumbers,
            minSpecial: preferences.minSpecial,
          }),
        )
        .with("passphrase", () =>
          generatePassphrase({
            words: preferences.words,
            separator: preferences.separator,
            capitalize: preferences.capitalize,
            includeNumber: preferences.includeNumber,
            customWords: preferences.useCustomWords ? preferences.customWords : undefined,
          }),
        )
        .with("pin", () => generatePin(preferences.pinLength))
        .with("username", () =>
          generateUsername({
            words: preferences.words,
            separator: preferences.separator,
            capitalize: preferences.capitalize,
            includeNumber: preferences.includeNumber,
            customWords: preferences.useCustomWords ? preferences.customWords : undefined,
            customWord: preferences.usernameCustomWord,
          }),
        )
        .with("email", () =>
          generateEmailAlias({
            email: preferences.email,
            mode: preferences.aliasMode,
            domain: preferences.aliasDomain,
          }),
        )
        .exhaustive();
    } catch (e) {
      error = e instanceof Error ? e.message : m.ui_generation_failed();
    } finally {
      generating = false;
    }
  }

  function changeMode(next: string) {
    preferences.mode = next as GeneratorMode;
    value = "";
    sshKey = null;
    error = "";
  }

  async function copy(text = value) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function download(filename: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  onMount(() => {
    preferences = parseGeneratorPreferences(localStorage.getItem(GENERATOR_SETTINGS_KEY));
    value = "";
    void generate();
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(GENERATOR_SETTINGS_KEY, JSON.stringify(preferences));
  });

  $effect(() => {
    if (!value && preferences.mode !== "email") void generate();
  });
</script>

<svelte:head><title>{m.ui_password_generator_edgewarden()}</title></svelte:head>

<VaultPageShell
  title={m.nav_generator()}
  description={m.ui_generated_entirely_on_your_device_using_cryptographically_secure_randomness()}
  width="compact"
>
  <Tabs.Root value={preferences.mode} onValueChange={changeMode}>
    <Tabs.List class="grid h-auto grid-cols-2 md:grid-cols-6">
      <Tabs.Trigger value="password">{m.ui_password()}</Tabs.Trigger><Tabs.Trigger
        value="passphrase">{m.ui_passphrase()}</Tabs.Trigger
      ><Tabs.Trigger value="pin">PIN</Tabs.Trigger><Tabs.Trigger value="username"
        >{m.ui_username()}</Tabs.Trigger
      ><Tabs.Trigger value="email">{m.ui_email_alias()}</Tabs.Trigger><Tabs.Trigger value="ssh"
        >{m.ui_ssh_key()}</Tabs.Trigger
      >
    </Tabs.List>

    <Card.Root>
      <Card.Header
        ><Card.Title>{m.ui_generated_result()}</Card.Title><Card.Description
          >{bits
            ? m.ui_estimated_entropy_value_bits({ value0: bits })
            : m.ui_choose_options_to_generate_a_result()}</Card.Description
        ></Card.Header
      >
      <Card.Content class="flex flex-col gap-3">
        {#if preferences.mode === "ssh" && sshKey}<Field.Group
            ><Field.Field
              ><Field.Label for="ssh-public">{m.ui_public_key()}</Field.Label><Textarea
                id="ssh-public"
                value={sshKey.publicKey}
                readonly
                rows={3}
                class="font-mono text-xs"
              />
              <div class="flex gap-2">
                <Button variant="outline" onclick={() => copy(sshKey?.publicKey)}
                  ><Copy data-icon="inline-start" />{m.ui_copy_public_key()}</Button
                ><Button
                  variant="outline"
                  onclick={() => download("id_edgewarden.pub", `${sshKey?.publicKey}\n`)}
                  ><Download data-icon="inline-start" />{m.ui_download()}</Button
                >
              </div></Field.Field
            ><Field.Field
              ><Field.Label for="ssh-private">{m.ui_private_key()}</Field.Label><Textarea
                id="ssh-private"
                value={sshKey.privateKey}
                readonly
                rows={10}
                class="font-mono text-xs"
              />
              <div class="flex gap-2">
                <Button variant="outline" onclick={() => copy(sshKey?.privateKey)}
                  ><Copy data-icon="inline-start" />{m.ui_copy_private_key()}</Button
                ><Button
                  variant="outline"
                  onclick={() => download("id_edgewarden", sshKey?.privateKey ?? "")}
                  ><Download data-icon="inline-start" />{m.ui_download()}</Button
                >
              </div></Field.Field
            ><Field.Field
              ><Field.Label for="ssh-fingerprint">{m.ui_fingerprint()}</Field.Label><Input
                id="ssh-fingerprint"
                value={sshKey.fingerprint}
                readonly
                class="font-mono"
              /></Field.Field
            ></Field.Group
          >{:else}<div class="flex gap-2">
            <Input
              {value}
              readonly
              class="font-mono"
              placeholder={preferences.mode === "email"
                ? m.ui_enter_an_email_address_or_domain_first()
                : ""}
            /><Button
              variant="outline"
              size="icon"
              onclick={() => copy()}
              disabled={!value}
              aria-label={m.ui_copy_result()}
              >{#if copied}<Check />{:else}<Copy />{/if}</Button
            >
          </div>{/if}
        {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
        <Button onclick={generate} disabled={generating}
          ><RefreshCw
            class={generating ? "animate-spin" : undefined}
            data-icon="inline-start"
          />{generating ? m.ui_generating() : m.ui_regenerate()}</Button
        >
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title>{m.ui_options()}</Card.Title></Card.Header>
      <Card.Content>
        <Field.Group>
          {#if preferences.mode === "password"}
            <Field.Field
              ><Field.Label for="length">{m.ui_length()}</Field.Label><Input
                id="length"
                type="number"
                min={4}
                max={128}
                bind:value={preferences.length}
              /></Field.Field
            >
            {#each [[m.ui_uppercase_letters(), "uppercase"], [m.ui_lowercase_letters(), "lowercase"], [m.ui_numbers(), "numbers"], [m.ui_special_characters(), "special"], [m.ui_avoid_ambiguous_characters(), "ambiguous"]] as option}
              <Field.Field orientation="horizontal"
                ><Field.Content><Field.Label>{option[0]}</Field.Label></Field.Content><Switch
                  checked={option[1] === "uppercase"
                    ? preferences.uppercase
                    : option[1] === "lowercase"
                      ? preferences.lowercase
                      : option[1] === "numbers"
                        ? preferences.numbers
                        : option[1] === "special"
                          ? preferences.special
                          : preferences.avoidAmbiguous}
                  onCheckedChange={(checked) => {
                    if (option[1] === "uppercase") preferences.uppercase = checked;
                    else if (option[1] === "lowercase") preferences.lowercase = checked;
                    else if (option[1] === "numbers") preferences.numbers = checked;
                    else if (option[1] === "special") preferences.special = checked;
                    else preferences.avoidAmbiguous = checked;
                  }}
                /></Field.Field
              >
            {/each}
            <div class="grid grid-cols-2 gap-3">
              {#if preferences.uppercase}<Field.Field
                  ><Field.Label>{m.ui_minimum_uppercase()}</Field.Label><Input
                    type="number"
                    min={1}
                    max={9}
                    bind:value={preferences.minUppercase}
                  /></Field.Field
                >{/if}{#if preferences.lowercase}<Field.Field
                  ><Field.Label>{m.ui_minimum_lowercase()}</Field.Label><Input
                    type="number"
                    min={1}
                    max={9}
                    bind:value={preferences.minLowercase}
                  /></Field.Field
                >{/if}{#if preferences.numbers}<Field.Field
                  ><Field.Label>{m.ui_minimum_numbers()}</Field.Label><Input
                    type="number"
                    min={1}
                    max={9}
                    bind:value={preferences.minNumbers}
                  /></Field.Field
                >{/if}{#if preferences.special}<Field.Field
                  ><Field.Label>{m.ui_minimum_special_characters()}</Field.Label><Input
                    type="number"
                    min={1}
                    max={9}
                    bind:value={preferences.minSpecial}
                  /></Field.Field
                >{/if}
            </div>
          {:else if preferences.mode === "passphrase" || preferences.mode === "username"}
            <Field.Field
              ><Field.Label for="words">{m.ui_number_of_words()}</Field.Label><Input
                id="words"
                type="number"
                min={preferences.mode === "username" ? 1 : 3}
                max={20}
                bind:value={preferences.words}
              /></Field.Field
            >
            <Field.Field
              ><Field.Label for="separator">{m.ui_separator()}</Field.Label><Input
                id="separator"
                maxlength={1}
                bind:value={preferences.separator}
              /></Field.Field
            >
            <Field.Field orientation="horizontal"
              ><Field.Content><Field.Label>{m.ui_capitalize_words()}</Field.Label></Field.Content
              ><Switch bind:checked={preferences.capitalize} /></Field.Field
            >
            <Field.Field orientation="horizontal"
              ><Field.Content><Field.Label>{m.ui_include_a_number()}</Field.Label></Field.Content
              ><Switch bind:checked={preferences.includeNumber} /></Field.Field
            >
            <Field.Field orientation="horizontal"
              ><Field.Content
                ><Field.Label>{m.ui_use_a_custom_word_list()}</Field.Label></Field.Content
              ><Switch bind:checked={preferences.useCustomWords} /></Field.Field
            >
            {#if preferences.useCustomWords}<Field.Field
                ><Field.Label for="custom-words"
                  >{m.ui_custom_words_separated_by_spaces_or_commas()}</Field.Label
                ><Textarea
                  id="custom-words"
                  rows={6}
                  bind:value={preferences.customWords}
                /></Field.Field
              >{/if}
            {#if preferences.mode === "username"}<Field.Field
                ><Field.Label for="username-prefix">{m.ui_fixed_word()}</Field.Label><Input
                  id="username-prefix"
                  maxlength={128}
                  bind:value={preferences.usernameCustomWord}
                /></Field.Field
              >{/if}
          {:else if preferences.mode === "pin"}
            <Field.Field
              ><Field.Label for="pin-length">{m.ui_pin_length()}</Field.Label><Input
                id="pin-length"
                type="number"
                min={3}
                max={64}
                bind:value={preferences.pinLength}
              /></Field.Field
            >
          {:else if preferences.mode === "email"}
            <Field.Field
              ><Field.Label>{m.ui_alias_type()}</Field.Label><Select.Root
                type="single"
                value={preferences.aliasMode}
                onValueChange={(value) =>
                  (preferences.aliasMode = value as typeof preferences.aliasMode)}
                ><Select.Trigger class="w-full"
                  >{match(preferences.aliasMode)
                    .with("plus", () => "Plus Addressing")
                    .with("catchall", () => m.ui_catch_all_domain())
                    .otherwise(() => m.ui_subdomain())}</Select.Trigger
                ><Select.Content
                  ><Select.Group
                    ><Select.Item value="plus">Plus Addressing</Select.Item><Select.Item
                      value="catchall">{m.ui_catch_all_domain()}</Select.Item
                    ><Select.Item value="subdomain">{m.ui_subdomain()}</Select.Item></Select.Group
                  ></Select.Content
                ></Select.Root
              ></Field.Field
            >
            {#if preferences.aliasMode === "catchall"}<Field.Field
                ><Field.Label for="alias-domain">{m.ui_domain()}</Field.Label><Input
                  id="alias-domain"
                  bind:value={preferences.aliasDomain}
                  placeholder="example.com"
                /></Field.Field
              >{:else}<Field.Field
                ><Field.Label for="alias-email">{m.ui_email_address_2()}</Field.Label><Input
                  id="alias-email"
                  type="email"
                  bind:value={preferences.email}
                  placeholder="me@example.com"
                /></Field.Field
              >{/if}
          {:else}
            <Field.Field
              ><Field.Label>{m.ui_key_type()}</Field.Label><Select.Root
                type="single"
                bind:value={preferences.sshType}
                ><Select.Trigger
                  >{preferences.sshType === "ed25519"
                    ? m.ui_ed25519_recommended()
                    : "RSA"}</Select.Trigger
                ><Select.Content
                  ><Select.Group
                    ><Select.Item value="ed25519">Ed25519</Select.Item><Select.Item value="rsa"
                      >RSA</Select.Item
                    ></Select.Group
                  ></Select.Content
                ></Select.Root
              ></Field.Field
            >
            {#if preferences.sshType === "rsa"}<Field.Field
                ><Field.Label>{m.ui_rsa_key_size()}</Field.Label><Select.Root
                  type="single"
                  bind:value={preferences.rsaLength}
                  ><Select.Trigger>{preferences.rsaLength} bits</Select.Trigger><Select.Content
                    ><Select.Group
                      ><Select.Item value="2048">2048</Select.Item><Select.Item value="3072"
                        >3072</Select.Item
                      ><Select.Item value="4096">4096</Select.Item></Select.Group
                    ></Select.Content
                  ></Select.Root
                ></Field.Field
              >{/if}
            <Field.Field
              ><Field.Label for="ssh-comment">{m.ui_comment()}</Field.Label><Input
                id="ssh-comment"
                bind:value={preferences.sshComment}
                placeholder="name@example.com"
              /></Field.Field
            >
          {/if}
        </Field.Group>
      </Card.Content>
    </Card.Root>
  </Tabs.Root>
</VaultPageShell>
