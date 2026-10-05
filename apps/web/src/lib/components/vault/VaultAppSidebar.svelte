<script lang="ts">
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

  const tools = [
    { href: "/vault", label: "我的保险库", icon: Lock },
    { href: "/vault/totp", label: "验证码", icon: KeyRound },
    { href: "/vault/password-health", label: "密码健康", icon: ShieldAlert },
    { href: "/vault/domains", label: "域名等效规则", icon: Globe },
    { href: "/vault/sends", label: "Send 传输中心", icon: Share2 },
    { href: "/vault/import-export", label: "导入与导出", icon: Upload },
    { href: "/vault/organizations", label: "组织共享", icon: Building2 },
    { href: "/vault/settings", label: "账户与安全", icon: Settings },
    { href: "/vault/generator", label: "密码生成器", icon: WandSparkles },
  ];

  const adminTools = [
    { href: "/vault/admin", label: "用户与邀请", icon: UserRoundCog },
    { href: "/vault/logs", label: "审计日志", icon: ScrollText },
    { href: "/vault/backups", label: "云备份中心", icon: Database },
  ];

  function isActive(href: string) {
    const pathname = navigating.to?.url.pathname ?? page.url.pathname;
    return href === "/vault" ? pathname === href : pathname.startsWith(href);
  }
</script>

<aside
  class="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r bg-background p-4"
  data-sveltekit-preload-code="eager"
>
  <nav class="flex flex-1 flex-col gap-1.5" aria-label="应用导航">
    <p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      保险库与工具
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
        管理
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
  <div class="mt-4" aria-label="版本信息">
    <Separator class="mb-3" />
    <p class="px-3 text-xs text-muted-foreground">Edgewarden v{appVersion.edgewarden}</p>
    {#if appVersion.bitwardenCompatibility}
      <p class="mt-1 px-3 text-xs text-muted-foreground">
        Bitwarden API {appVersion.bitwardenCompatibility}
      </p>
    {/if}
  </div>
</aside>
