<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import {
    Building2,
    Database,
    Globe,
    KeyRound,
    Lock,
    ScrollText,
    Settings,
    Share2,
    ShieldAlert,
    Upload,
    UserRoundCog,
    WandSparkles,
  } from "@lucide/svelte";
  import { navigating, page } from "$app/state";
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { loadAppVersion, type AppVersionInfo } from "$lib/services/app-version";
  import { vault } from "$lib/stores/vault.svelte";
  import { EDGEWARDEN_VERSION } from "@edgewarden/shared";

  let { onNavigate }: { onNavigate?: () => void } = $props();
  let appVersion = $state<AppVersionInfo>({
    edgewarden: EDGEWARDEN_VERSION,
    bitwardenCompatibility: null,
  });

  onMount(() => {
    void loadAppVersion().then((version) => {
      appVersion = version;
    });
  });

  const tools = $derived([
    { href: "/vault", label: m.nav_vault(), icon: Lock },
    { href: "/vault/totp", label: m.nav_totp(), icon: KeyRound },
    { href: "/vault/password-health", label: m.nav_health(), icon: ShieldAlert },
    { href: "/vault/domains", label: m.nav_domains(), icon: Globe },
    { href: "/vault/sends", label: m.nav_sends(), icon: Share2 },
    { href: "/vault/import-export", label: m.nav_import_export(), icon: Upload },
    { href: "/vault/organizations", label: m.nav_organizations(), icon: Building2 },
    { href: "/vault/settings", label: m.nav_settings(), icon: Settings },
    { href: "/vault/generator", label: m.nav_generator(), icon: WandSparkles },
  ]);

  const adminTools = $derived([
    { href: "/vault/admin", label: m.nav_users(), icon: UserRoundCog },
    { href: "/vault/logs", label: m.nav_logs(), icon: ScrollText },
    { href: "/vault/backups", label: m.nav_backups(), icon: Database },
  ]);

  function isActive(href: string) {
    const pathname = navigating.to?.url.pathname ?? page.url.pathname;
    return href === "/vault" ? pathname === href : pathname.startsWith(href);
  }
</script>

<aside
  class="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r bg-background p-4"
  data-sveltekit-preload-code="eager"
>
  <nav class="flex flex-1 flex-col gap-1.5" aria-label={m.nav_label()}>
    <p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {m.nav_tools()}
    </p>
    {#each tools as item (item.href)}
      <Button
        href={item.href}
        variant={isActive(item.href) ? "secondary" : "ghost"}
        class="w-full justify-start"
        aria-current={isActive(item.href) ? "page" : undefined}
        data-sveltekit-preload-data="hover"
        onclick={onNavigate}
      >
        <item.icon data-icon="inline-start" />
        <span>{item.label}</span>
      </Button>
    {/each}

    {#if vault.profile?.role === "admin"}
      <Separator class="my-2" />
      <p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {m.nav_admin()}
      </p>
      {#each adminTools as item (item.href)}
        <Button
          href={item.href}
          variant={isActive(item.href) ? "secondary" : "ghost"}
          class="w-full justify-start"
          aria-current={isActive(item.href) ? "page" : undefined}
          data-sveltekit-preload-data="hover"
          onclick={onNavigate}
        >
          <item.icon data-icon="inline-start" />
          <span>{item.label}</span>
        </Button>
      {/each}
    {/if}
  </nav>
  <div class="mt-4" aria-label={m.nav_version()}>
    <Separator class="mb-3" />
    <p class="px-3 text-xs text-muted-foreground">Edgewarden v{appVersion.edgewarden}</p>
    {#if appVersion.bitwardenCompatibility}
      <p class="mt-1 px-3 text-xs text-muted-foreground">
        Bitwarden API {appVersion.bitwardenCompatibility}
      </p>
    {/if}
  </div>
</aside>
