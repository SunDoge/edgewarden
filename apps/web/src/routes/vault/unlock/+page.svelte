<script lang="ts">
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import { isLoggedIn } from "$lib/services/api-auth";
import { errorMessage } from "$lib/services/error-message";
import { loadVaultSnapshot } from "$lib/services/vault-db";
import { vault, unlock } from "$lib/stores/vault.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as Alert from "$lib/components/ui/alert/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
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
	} catch (caught) {
		error = errorMessage(caught, "解锁失败，请检查主密码是否正确。");
	} finally {
		loading = false;
	}
}
</script>

<svelte:head>
	<title>解锁保险库 - Edgewarden</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
	<div class="absolute right-4 top-4"><ThemeToggle /></div>
	<Card.Root class="w-full max-w-sm">
		<!-- Logo -->
		<Card.Header class="items-center gap-2 text-center">
			<div class="mb-4 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
				<ShieldCheck class="size-8" />
			</div>
			<Card.Title class="text-2xl">解锁您的保险库</Card.Title>
			{#if email}
				<Card.Description>{email}</Card.Description>
			{/if}
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">

		{#if !hasCache}
			<!-- No cache: must be online to unlock -->
			<Alert.Root><WifiOff /><Alert.Title>需要联网登录</Alert.Title><Alert.Description>首次使用请先联网登录，之后才可离线解锁。</Alert.Description></Alert.Root>
			<Button class="w-full" onclick={() => goto("/login")}>返回登录</Button>
		{:else}
			<!-- Unlock form -->
			{#if error}
				<Alert.Root variant="destructive"><Alert.Title>解锁失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>
			{/if}

			<form onsubmit={handleUnlock}><Field.Group>
				<Field.Field>
					<Field.Label for="password">主密码</Field.Label>
					<div class="relative">
						<span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
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
						<Button
							type="button"
							variant="ghost" size="icon-xs" class="absolute right-1 top-1/2 -translate-y-1/2"
							onclick={() => (showPassword = !showPassword)}
							aria-label={showPassword ? "隐藏密码" : "显示密码"}
						>
							{#if showPassword}
								<EyeOff class="size-4" />
							{:else}
								<Eye class="size-4" />
							{/if}
						</Button>
					</div>
				</Field.Field>

				<Button type="submit" class="w-full" disabled={loading || !password}>
					{#if loading}
						<Spinner data-icon="inline-start" />
						正在解锁...
					{:else}
						解锁保险库
					{/if}
				</Button>
			</Field.Group></form>

			<div class="text-center">
				<a href="/login" class="text-sm text-muted-foreground hover:text-primary hover:underline">
					使用其他账号登录
				</a>
			</div>
		{/if}
		</Card.Content>
	</Card.Root>
</div>
