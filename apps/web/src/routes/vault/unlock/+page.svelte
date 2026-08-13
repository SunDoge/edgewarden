<script lang="ts">
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import { isLoggedIn } from "$lib/services/api";
import { loadVaultSnapshot } from "$lib/services/vault-db";
import { vault, unlock } from "$lib/stores/vault.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Label } from "$lib/components/ui/label/index.js";
import { ShieldCheck, KeyRound, Eye, EyeOff, WifiOff } from "@lucide/svelte";
import ThemeToggle from "$lib/components/theme-toggle.svelte";

let email = $state("");
let showPassword = $state(false);
let password = $state("");
let loading = $state(false);
let error = $state("");
let hasCache = $state(false);

onMount(async () => {
	if (!isLoggedIn()) {
		goto("/login");
		return;
	}
	if (vault.isUnlocked) {
		goto("/vault");
		return;
	}

	// Pre-fill email from the cached profile so the user knows whose vault this is
	const cached = await loadVaultSnapshot();
	if (cached) {
		email = cached.profile.email;
		hasCache = true;
	}
});

async function handleUnlock(e: SubmitEvent) {
	e.preventDefault();
	if (!password) return;

	loading = true;
	error = "";

	try {
		await unlock(password);
		goto("/vault");
	} catch (err: any) {
		error = err.message || "解锁失败，请检查主密码是否正确。";
	} finally {
		loading = false;
	}
}
</script>

<svelte:head>
	<title>解锁保险库 - Edgewarden</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
	<div class="absolute right-4 top-4"><ThemeToggle /></div>
	<div class="w-full max-w-sm space-y-6">
		<!-- Logo -->
		<div class="text-center space-y-2">
			<div class="mx-auto w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground mb-4">
				<ShieldCheck class="size-8" />
			</div>
			<h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">解锁您的保险库</h1>
			{#if email}
				<p class="text-sm text-slate-500">{email}</p>
			{/if}
		</div>

		{#if !hasCache}
			<!-- No cache: must be online to unlock -->
			<div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex items-start gap-3 text-amber-700 dark:text-amber-400 text-sm">
				<WifiOff class="size-4 shrink-0 mt-0.5" />
				<span>首次使用请先联网登录，之后才可离线解锁。</span>
			</div>
			<Button class="w-full" onclick={() => goto("/login")}>返回登录</Button>
		{:else}
			<!-- Unlock form -->
			{#if error}
				<div class="p-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
					{error}
				</div>
			{/if}

			<form onsubmit={handleUnlock} class="space-y-4">
				<div class="space-y-2">
					<Label for="password">主密码</Label>
					<div class="relative">
						<span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
							<KeyRound class="size-4" />
						</span>
						<Input
							id="password"
							type={showPassword ? "text" : "password"}
							placeholder="输入您的主密码"
							bind:value={password}
							disabled={loading}
							class="pl-10 pr-10"
							required
							autofocus
						/>
						<button
							type="button"
							class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
							onclick={() => (showPassword = !showPassword)}
						>
							{#if showPassword}
								<EyeOff class="size-4" />
							{:else}
								<Eye class="size-4" />
							{/if}
						</button>
					</div>
				</div>

				<Button type="submit" class="w-full" disabled={loading || !password}>
					{#if loading}
						<div class="size-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2"></div>
						正在解锁...
					{:else}
						解锁保险库
					{/if}
				</Button>
			</form>

			<div class="text-center">
				<a href="/login" class="text-sm text-slate-500 hover:text-primary hover:underline">
					使用其他账号登录
				</a>
			</div>
		{/if}
	</div>
</div>
