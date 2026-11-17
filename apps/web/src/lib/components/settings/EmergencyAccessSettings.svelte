<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Select from "#lib/components/ui/select/index.js";
  import * as m from "#lib/paraglide/messages.js";
  import {
    approveEmergencyAccessApi,
    confirmEmergencyContactApi,
    deleteEmergencyAccessApi,
    type EmergencyAccessEntry,
    getUserPublicKeyApi,
    initiateEmergencyAccessApi,
    inviteEmergencyContactApi,
    listGrantedEmergencyAccessApi,
    listTrustedEmergencyContactsApi,
    rejectEmergencyAccessApi,
    setEmergencyAccessPasswordApi,
    takeoverEmergencyAccessApi,
    viewEmergencyAccessApi,
  } from "#lib/services/api-emergency-access.ts";
  import { decryptCipher } from "#lib/services/cipher-crypto.ts";
  import {
    deriveMasterKey,
    deriveMasterPasswordHash,
    encryptBw,
    hkdfExpand,
  } from "#lib/services/crypto.ts";
  import {
    importAccountPrivateKey,
    unwrapOrganizationKey,
    wrapOrganizationKey,
  } from "#lib/services/organization-crypto.ts";
  import { vault } from "#lib/stores/vault.svelte.ts";

  let {
    onMessage,
    onError,
  }: { onMessage: (value: string) => void; onError: (value: unknown) => void } = $props();
  let trusted = $state<EmergencyAccessEntry[]>([]);
  let granted = $state<EmergencyAccessEntry[]>([]);
  let email = $state("");
  let type = $state<"0" | "1">("0");
  let waitDays = $state("7");
  let busy = $state("");
  let viewedNames = $state<Record<string, string[]>>({});
  let takeoverPasswords = $state<Record<string, string>>({});

  const statusLabel = (status: number) =>
    [
      "",
      m.ui_awaiting_confirmation(),
      m.ui_ready(),
      m.ui_access_requested(),
      m.ui_access_approved(),
    ][status] ?? String(status);

  async function load() {
    const [a, b] = await Promise.all([
      listTrustedEmergencyContactsApi(),
      listGrantedEmergencyAccessApi(),
    ]);
    trusted = a.data;
    granted = b.data;
  }
  onMount(() => void load().catch(onError));

  async function action(id: string, operation: () => Promise<unknown>, message: string) {
    busy = id;
    try {
      await operation();
      await load();
      onMessage(message);
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }
  async function invite() {
    await action(
      "invite",
      () => inviteEmergencyContactApi(email.trim(), Number(type) as 0 | 1, Number(waitDays)),
      m.ui_emergency_contact_added(),
    );
    email = "";
  }
  async function confirm(entry: EmergencyAccessEntry) {
    if (!entry.granteeId || !vault.symEncKey || !vault.symMacKey) return;
    const { publicKey } = await getUserPublicKeyApi(entry.granteeId);
    const key = await wrapOrganizationKey(
      { encKey: vault.symEncKey, macKey: vault.symMacKey },
      publicKey,
    );
    await action(
      entry.id,
      () => confirmEmergencyContactApi(entry.id, key),
      m.ui_emergency_contact_confirmed(),
    );
  }
  async function view(entry: EmergencyAccessEntry) {
    if (!vault.profile?.privateKey || !vault.symEncKey || !vault.symMacKey) return;
    busy = entry.id;
    try {
      const response = await viewEmergencyAccessApi(entry.id);
      const privateKey = await importAccountPrivateKey(
        vault.profile.privateKey,
        vault.symEncKey,
        vault.symMacKey,
      );
      const key = await unwrapOrganizationKey(response.keyEncrypted, privateKey);
      const ciphers = await Promise.all(
        response.ciphers.map((cipher) => decryptCipher(cipher as never, key.encKey, key.macKey)),
      );
      viewedNames = { ...viewedNames, [entry.id]: ciphers.map((cipher) => String(cipher.name)) };
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }
  async function takeover(entry: EmergencyAccessEntry) {
    const password = takeoverPasswords[entry.id] ?? "";
    if (password.length < 12 || !vault.profile?.privateKey || !vault.symEncKey || !vault.symMacKey)
      return;
    busy = entry.id;
    try {
      const response = await takeoverEmergencyAccessApi(entry.id);
      if (response.kdf !== 0) throw new Error(m.ui_emergency_takeover_pbkdf_only());
      const privateKey = await importAccountPrivateKey(
        vault.profile.privateKey,
        vault.symEncKey,
        vault.symMacKey,
      );
      const userKey = await unwrapOrganizationKey(response.keyEncrypted, privateKey);
      const raw = new Uint8Array(64);
      raw.set(userKey.encKey);
      raw.set(userKey.macKey, 32);
      const masterKey = await deriveMasterKey(password, response.salt, response.kdfIterations);
      const hash = await deriveMasterPasswordHash(masterKey, password);
      const enc = await hkdfExpand(new Uint8Array(masterKey), "enc", 32);
      const mac = await hkdfExpand(new Uint8Array(masterKey), "mac", 32);
      await setEmergencyAccessPasswordApi(entry.id, hash, await encryptBw(raw, enc, mac));
      takeoverPasswords = { ...takeoverPasswords, [entry.id]: "" };
      onMessage(m.ui_account_takeover_completed());
    } catch (error) {
      onError(error);
    } finally {
      busy = "";
    }
  }
</script>

<Card.Root>
  <Card.Header
    ><Card.Title>{m.ui_emergency_access()}</Card.Title><Card.Description
      >{m.ui_emergency_access_description()}</Card.Description
    ></Card.Header
  >
  <Card.Content class="flex flex-col gap-6">
    <div class="grid gap-3 sm:grid-cols-[1fr_10rem_8rem_auto]">
      <Input type="email" bind:value={email} placeholder={m.ui_email()} />
      <Select.Root type="single" bind:value={type}
        ><Select.Trigger class="w-full"
          >{type === "0" ? m.ui_view_only() : m.ui_account_takeover()}</Select.Trigger
        ><Select.Content
          ><Select.Item value="0">{m.ui_view_only()}</Select.Item><Select.Item value="1"
            >{m.ui_account_takeover()}</Select.Item
          ></Select.Content
        ></Select.Root
      >
      <Input type="number" min="1" max="90" bind:value={waitDays} aria-label={m.ui_wait_days()} />
      <Button onclick={invite} disabled={!email.trim() || busy === "invite"}>{m.ui_add()}</Button>
    </div>
    <div class="flex flex-col gap-3">
      <h3 class="font-medium">{m.ui_your_emergency_contacts()}</h3>
      {#if !trusted.length}<p class="text-sm text-muted-foreground">
          {m.ui_no_emergency_contacts()}
        </p>{/if}
      {#each trusted as entry (entry.id)}
        <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{entry.name || entry.email}</p>
            <p class="text-sm text-muted-foreground">
              {entry.email} · {entry.waitTimeDays}
              {m.ui_days()}
            </p>
          </div>
          <Badge variant="secondary">{statusLabel(entry.status)}</Badge>
          {#if entry.status === 1}<Button
              size="sm"
              onclick={() => confirm(entry)}
              disabled={busy === entry.id}>{m.ui_confirm()}</Button
            >{/if}
          {#if entry.status === 3}<Button
              size="sm"
              onclick={() =>
                action(entry.id, () => approveEmergencyAccessApi(entry.id), m.ui_access_approved())}
              >{m.ui_approve()}</Button
            ><Button
              size="sm"
              variant="outline"
              onclick={() =>
                action(entry.id, () => rejectEmergencyAccessApi(entry.id), m.ui_access_rejected())}
              >{m.ui_reject()}</Button
            >{/if}
          <Button
            size="sm"
            variant="ghost"
            onclick={() =>
              action(
                entry.id,
                () => deleteEmergencyAccessApi(entry.id),
                m.ui_emergency_contact_removed(),
              )}>{m.ui_remove()}</Button
          >
        </div>
      {/each}
    </div>
    <div class="flex flex-col gap-3">
      <h3 class="font-medium">{m.ui_accounts_you_can_access()}</h3>
      {#if !granted.length}<p class="text-sm text-muted-foreground">
          {m.ui_no_emergency_access_granted()}
        </p>{/if}
      {#each granted as entry (entry.id)}<div class="rounded-lg border p-3">
          <div class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <p class="font-medium">{entry.name || entry.email}</p>
              <p class="text-sm text-muted-foreground">
                {entry.type === 0 ? m.ui_view_only() : m.ui_account_takeover()} · {statusLabel(
                  entry.status,
                )}
              </p>
            </div>
            {#if entry.status === 2}<Button
                size="sm"
                onclick={() =>
                  action(
                    entry.id,
                    () => initiateEmergencyAccessApi(entry.id),
                    m.ui_access_requested(),
                  )}>{m.ui_request_access()}</Button
              >{/if}
            {#if entry.status === 4 && entry.type === 0}<Button
                size="sm"
                onclick={() => view(entry)}>{m.ui_view_vault()}</Button
              >{/if}
          </div>
          {#if viewedNames[entry.id]}<ul class="mt-3 list-disc pl-5 text-sm">
              {#each viewedNames[entry.id] as name}<li>{name}</li>{/each}
            </ul>{/if}
          {#if entry.status === 4 && entry.type === 1}<div class="mt-3 flex gap-2">
              <Input
                type="password"
                value={takeoverPasswords[entry.id] ?? ""}
                oninput={(event) =>
                  (takeoverPasswords = {
                    ...takeoverPasswords,
                    [entry.id]: event.currentTarget.value,
                  })}
                placeholder={m.ui_new_master_password()}
              /><Button
                variant="destructive"
                disabled={(takeoverPasswords[entry.id]?.length ?? 0) < 12 || busy === entry.id}
                onclick={() => takeover(entry)}>{m.ui_complete_takeover()}</Button
              >
            </div>{/if}
        </div>{/each}
    </div>
  </Card.Content>
</Card.Root>
