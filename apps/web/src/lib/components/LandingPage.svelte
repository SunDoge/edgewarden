<script lang="ts">
  import { ArrowRight, Code, KeyRound, ShieldCheck, Smartphone, Cloud } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import LanguageSwitcher from "$lib/components/LanguageSwitcher.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import { m } from "$lib/paraglide/messages.js";

  let { demo }: { demo: boolean } = $props();
  const repository = "https://github.com/SunDoge/edgewarden";
</script>

<svelte:head>
  <title>{m.landing_title()} — Edgewarden</title>
  <meta name="description" content={m.landing_description()} />
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
  <header class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
    <a href="/" class="inline-flex items-center gap-2 font-semibold">
      <ShieldCheck class="size-6" aria-hidden="true" />Edgewarden
    </a>
    <nav aria-label={m.nav_label()} class="flex items-center gap-1">
      <LanguageSwitcher />
      <ThemeToggle />
      <Button href={repository} variant="ghost" size="icon" aria-label="GitHub">
        <Code data-icon />
      </Button>
    </nav>
  </header>

  <main class="mx-auto max-w-6xl px-6">
    <section
      class="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.3fr_1fr]"
      aria-labelledby="landing-heading"
    >
      <div class="flex flex-col items-start gap-6">
        <Badge variant="outline">{m.landing_eyebrow()}</Badge>
        <h1
          id="landing-heading"
          class="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl"
        >
          {m.landing_title()}
        </h1>
        <p class="max-w-xl text-lg leading-relaxed text-muted-foreground">
          {m.landing_description()}
        </p>
        <div class="flex flex-wrap gap-3">
          <Button href="/login" size="lg">
            {demo ? m.landing_try_demo() : m.landing_open_vault()}<ArrowRight
              data-icon="inline-end"
            />
          </Button>
          <Button href={`${repository}#deploy-to-cloudflare`} variant="outline" size="lg"
            >{m.demo_self_host()}</Button
          >
        </div>
        {#if demo}<p class="max-w-lg text-sm leading-relaxed text-muted-foreground">
            {m.landing_demo_note()}
          </p>{/if}
      </div>

      <!-- A labeled, non-interactive sample, never a preview of the user's vault. -->
      <figure class="min-w-0 rounded-xl border bg-muted/20 p-6 sm:p-8">
        <figcaption class="mb-6 flex flex-wrap items-center justify-between gap-3">
          <span class="font-medium">{m.landing_sample()}</span>
          <Badge variant="secondary">{m.landing_sample_badge()}</Badge>
        </figcaption>
        <div class="flex items-center gap-3 py-4">
          <KeyRound class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="font-medium">GitHub</p>
            <p class="truncate text-sm text-muted-foreground">demo@example.com</p>
          </div>
          <span class="font-mono text-muted-foreground" aria-label={m.landing_hidden_password()}
            >••••••••</span
          >
        </div>
        <Separator />
        <div class="flex items-center gap-3 py-4">
          <KeyRound class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="font-medium">Cloudflare</p>
            <p class="truncate text-sm text-muted-foreground">demo@example.com</p>
          </div>
          <span class="font-mono text-muted-foreground" aria-label={m.landing_hidden_password()}
            >••••••••</span
          >
        </div>
        <Separator />
        <p class="mt-6 text-sm leading-relaxed text-muted-foreground">{m.landing_sample_note()}</p>
      </figure>
    </section>

    <Separator />
    <section aria-label={m.landing_features()} class="grid gap-10 py-12 md:grid-cols-3">
      <div class="flex flex-col gap-3">
        <ShieldCheck class="size-5" aria-hidden="true" />
        <h2 class="font-semibold">{m.landing_encryption()}</h2>
        <p class="text-sm leading-relaxed text-muted-foreground">{m.landing_encryption_text()}</p>
      </div>
      <div class="flex flex-col gap-3">
        <Smartphone class="size-5" aria-hidden="true" />
        <h2 class="font-semibold">{m.landing_clients()}</h2>
        <p class="text-sm leading-relaxed text-muted-foreground">{m.landing_clients_text()}</p>
      </div>
      <div class="flex flex-col gap-3">
        <Cloud class="size-5" aria-hidden="true" />
        <h2 class="font-semibold">{m.landing_hosting()}</h2>
        <p class="text-sm leading-relaxed text-muted-foreground">{m.landing_hosting_text()}</p>
      </div>
    </section>
    <Separator />
  </main>
  <footer
    class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 pb-20 pt-8"
  >
    <p class="text-sm text-muted-foreground">{m.landing_contribute()}</p>
    <Button href={repository} variant="outline"
      ><Code data-icon="inline-start" />{m.landing_github()}</Button
    >
  </footer>
</div>
