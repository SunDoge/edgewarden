<script lang="ts">
import { goto } from "$app/navigation";
import { deriveMasterKey } from "$lib/services/crypto";
import { isTwoFactorRequiredError, login, loginWithPasskeyApi, twoFactorPasskeyChallengeFromError, twoFactorProvidersFromError } from "$lib/services/api";
import { setMasterKey, setSymmetricKeys, syncVaultData } from "$lib/stores/vault.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Label } from "$lib/components/ui/label/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { assertTwoFactorPasskeyCredential } from "$lib/services/passkeys";
import { Eye, EyeOff, ShieldAlert, KeyRound, Mail, Fingerprint } from "@lucide/svelte";

let email = $state("");
let password = $state("");
let showPassword = $state(false);
let loading = $state(false);
let error = $state("");
let twoFactorRequired = $state(false);
let twoFactorToken = $state("");
let twoFactorProvider = $state<"0" | "3" | "8">("0");
let availableTwoFactorProviders = $state<string[]>([]);
let passkeyUnlock = $state<{ email: string; iterations: number; profileKey: string } | null>(null);
let passkeyPassword = $state("");
let twoFactorPasskeyChallenge = $state<{ options: unknown; token: string } | null>(null);

async function handleSubmit(e: SubmitEvent) {
	e.preventDefault();
	if (!email || !password) {
		error = "请输入电子邮件和主密码。";
		return;
	}

	loading = true;
	error = "";

	try {
		const { masterKey } = await login(email, password, twoFactorRequired ? { token: twoFactorToken, provider: twoFactorProvider } : undefined);
		setMasterKey(masterKey);
		await syncVaultData(); // saves snapshot to IndexedDB for future offline use
		goto("/vault");
	} catch (err: any) {
		if (isTwoFactorRequiredError(err)) {
			twoFactorRequired = true;
			twoFactorPasskeyChallenge = twoFactorPasskeyChallengeFromError(err);
			availableTwoFactorProviders = twoFactorProvidersFromError(err);
			if (!availableTwoFactorProviders.includes("0") && availableTwoFactorProviders.includes("3")) twoFactorProvider = "3";
				error = "请输入身份验证器验证码或恢复代码。";
		} else error = err.message || "登录失败，请检查您的凭据。";
	} finally {
		loading = false;
	}
}

async function completeTwoFactorPasskey() {
	if (!twoFactorPasskeyChallenge) return;
	loading = true;
	error = "";
	try {
		const assertion = await assertTwoFactorPasskeyCredential(twoFactorPasskeyChallenge);
		const { masterKey } = await login(email, password, { provider: "7", token: JSON.stringify(assertion) });
		setMasterKey(masterKey);
		await syncVaultData();
		await goto("/vault");
	} catch (value) { error = value instanceof Error ? value.message : "安全密钥验证失败"; } finally { loading = false; }
}

async function handlePasskeyLogin() {
	loading = true;
	error = "";
	try {
		const result = await loginWithPasskeyApi();
		if (result.symEncKey && result.symMacKey) {
			setSymmetricKeys(result.symEncKey, result.symMacKey);
			await syncVaultData();
			await goto("/vault");
			return;
		}
		if (!result.masterPasswordUnlock?.email || !result.masterPasswordUnlock.profileKey) throw new Error("这把通行密钥无法解锁保险库");
		passkeyUnlock = result.masterPasswordUnlock;
	} catch (err) { error = err instanceof Error ? err.message : "通行密钥登录失败"; } finally { loading = false; }
}

async function completePasskeyUnlock() {
	if (!passkeyUnlock || !passkeyPassword) return;
	loading = true;
	try {
		setMasterKey(await deriveMasterKey(passkeyPassword, passkeyUnlock.email, passkeyUnlock.iterations));
		await syncVaultData();
		await goto("/vault");
	} catch (err) { error = err instanceof Error ? err.message : "主密码不正确"; } finally { loading = false; }
}
</script>

<svelte:head>
	<title>登录 - Edgewarden</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
	<Card.Root class="w-full max-w-md shadow-lg border-slate-100 dark:border-slate-800">
		<Card.Header class="space-y-2 text-center">
			<div class="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2">
				<KeyRound class="size-6" />
			</div>
			<Card.Title class="text-2xl font-bold tracking-tight">登录到 Edgewarden</Card.Title>
			<Card.Description>
				自托管的零知识密码库管理器
			</Card.Description>
		</Card.Header>

		<Card.Content>
			{#if error}
				<div class="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2.5 border border-destructive/20 animate-in fade-in slide-in-from-top-1 duration-200">
					<ShieldAlert class="size-4 shrink-0 mt-0.5" />
					<span>{error}</span>
				</div>
			{/if}

			<form onsubmit={handleSubmit} class="space-y-4">
				<div class="space-y-2">
					<Label for="email">电子邮件地址</Label>
					<div class="relative">
						<span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
							<Mail class="size-4" />
						</span>
						<Input
							id="email"
							type="email"
							placeholder="name@example.com"
							bind:value={email}
							disabled={loading}
							class="pl-10"
							required
						/>
					</div>
				</div>

				{#if twoFactorRequired}
					<div class="space-y-2"><div class="flex items-center justify-between"><Label for="two-factor-token">{twoFactorProvider === "0" ? "两步验证码" : twoFactorProvider === "3" ? "YubiKey OTP" : "恢复代码"}</Label><div class="flex gap-2">{#if availableTwoFactorProviders.includes("3")}<button type="button" class="text-xs text-primary hover:underline" onclick={() => { twoFactorProvider = "3"; twoFactorToken = ""; }}>YubiKey</button>{/if}<button type="button" class="text-xs text-primary hover:underline" onclick={() => { twoFactorProvider = twoFactorProvider === "0" ? "8" : "0"; twoFactorToken = ""; }}>{twoFactorProvider === "0" ? "使用恢复代码" : "使用身份验证器"}</button></div></div><Input id="two-factor-token" bind:value={twoFactorToken} inputmode={twoFactorProvider === "0" ? "numeric" : "text"} autocomplete="one-time-code" maxlength={64} required /></div>
					{#if twoFactorPasskeyChallenge}<Button type="button" variant="outline" class="w-full" onclick={completeTwoFactorPasskey} disabled={loading}><Fingerprint />使用安全密钥验证</Button>{/if}
				{/if}

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<Label for="password">主密码</Label>
					</div>
					<div class="relative">
						<span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
							<KeyRound class="size-4" />
						</span>
						<Input
							id="password"
							type={showPassword ? "text" : "password"}
							placeholder="••••••••••••"
							bind:value={password}
							disabled={loading}
							class="pl-10 pr-10"
							required
						/>
						<button
							type="button"
							class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
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

				<Button type="submit" class="w-full mt-2" disabled={loading}>
					{#if loading}
						<div class="size-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2"></div>
						正在进行安全解密...
					{:else}
						解锁密码库
					{/if}
				</Button>
			</form>

			<div class="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span class="h-px flex-1 bg-border"></span>或<span class="h-px flex-1 bg-border"></span></div>
			<Button type="button" variant="outline" class="w-full" onclick={handlePasskeyLogin} disabled={loading}><Fingerprint />使用通行密钥登录</Button>

			{#if passkeyUnlock}
				<form class="mt-4 space-y-3 rounded-md border p-3" onsubmit={(event) => { event.preventDefault(); void completePasskeyUnlock(); }}><p class="text-sm text-muted-foreground">这把通行密钥仅用于登录。请输入主密码解锁保险库。</p><Label for="passkey-password">主密码</Label><Input id="passkey-password" type="password" bind:value={passkeyPassword} autocomplete="current-password" required /><Button class="w-full" type="submit" disabled={loading}>解锁保险库</Button></form>
			{/if}
		</Card.Content>

		<Card.Footer class="flex flex-col items-center border-t border-slate-100 dark:border-slate-800 py-4 gap-2">
			<a href="/recover-2fa" class="text-sm text-primary font-medium hover:underline">无法使用两步验证？</a>
			<p class="text-sm text-slate-500">
				还没有账号？
				<a href="/register" class="text-primary font-medium hover:underline">
					立即注册
				</a>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
