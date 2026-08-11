<script lang="ts">
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import { getRegistrationConfigApi, register } from "$lib/services/api";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Label } from "$lib/components/ui/label/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import {
	Eye,
	EyeOff,
	ShieldAlert,
	KeyRound,
	Mail,
	User,
	Info,
	CheckCircle2,
} from "@lucide/svelte";

let email = $state("");
let name = $state("");
let password = $state("");
let confirmPassword = $state("");
let hint = $state("");
let iterations = $state(600000);
let inviteCode = $state("");
let adminPassword = $state("");
let configLoading = $state(true);
let signupsAllowed = $state(false);
let invitationsAllowed = $state(false);
let bootstrapRequired = $state(false);
let adminPasswordConfigured = $state(false);

onMount(async () => {
	inviteCode = new URLSearchParams(location.search).get("invite")?.trim() ?? "";
	try {
		const config = await getRegistrationConfigApi();
		signupsAllowed = config.signupsAllowed;
		invitationsAllowed = config.invitationsAllowed;
		bootstrapRequired = config.bootstrapRequired;
		adminPasswordConfigured = config.adminPasswordConfigured;
	} catch (err: any) {
		error = err.message || "无法加载注册配置。";
	} finally {
		configLoading = false;
	}
});

let showPassword = $state(false);
let showConfirmPassword = $state(false);
let loading = $state(false);
let error = $state("");
let success = $state(false);

let isPasswordMatch = $derived(password === confirmPassword);
let isPasswordLengthValid = $derived(password.length >= 8);
let registrationAvailable = $derived(
	bootstrapRequired ||
		signupsAllowed ||
		(invitationsAllowed && Boolean(inviteCode.trim())),
);

async function handleSubmit(e: SubmitEvent) {
	e.preventDefault();
	if (!email || !password || !confirmPassword) {
		error = "请填写所有必填字段。";
		return;
	}
	if (bootstrapRequired && !adminPassword) {
		error = "首次创建管理员账号需要部署管理员密码。";
		return;
	}

	if (!isPasswordMatch) {
		error = "两次输入的密码不一致。";
		return;
	}

	if (!isPasswordLengthValid) {
		error = "主密码长度必须至少为 8 位。";
		return;
	}

	if (iterations < 100000) {
		error = "为了您的安全，KDF 迭代次数不能低于 100,000 次。";
		return;
	}

	loading = true;
	error = "";

	try {
		await register(
			email,
			password,
			name,
			hint,
			iterations,
			inviteCode,
			adminPassword,
		);
		success = true;
		setTimeout(() => {
			goto("/login");
		}, 2000);
	} catch (err: any) {
		error = err.message || "注册失败，请稍后重试。";
	} finally {
		loading = false;
	}
}
</script>

<svelte:head>
	<title>注册账号 - Edgewarden</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
	<Card.Root class="w-full max-w-lg shadow-lg border-slate-100 dark:border-slate-800">
		<Card.Header class="space-y-2 text-center">
			<div class="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2">
				<User class="size-6" />
			</div>
			<Card.Title class="text-2xl font-bold tracking-tight">创建您的 Edgewarden 账号</Card.Title>
			<Card.Description>
				请记住您设置的主密码，它是解密您所有密码的唯一钥匙。
			</Card.Description>
		</Card.Header>

		<Card.Content>
			{#if success}
				<div class="p-6 rounded-lg bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 text-center border border-green-200 dark:border-green-900/50 space-y-3">
					<CheckCircle2 class="size-12 mx-auto animate-bounce" />
					<h4 class="font-bold text-lg">注册成功！</h4>
					<p class="text-sm">您的零知识密码库已初始化。正在为您跳转到登录页面...</p>
				</div>
			{:else}
				{#if !configLoading && bootstrapRequired && !adminPasswordConfigured}
					<div class="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20">
						服务端尚未配置 BOOTSTRAP_SECRET，无法安全创建首个管理员账号。
					</div>
				{:else if !configLoading && !registrationAvailable}
					<div class="mb-4 p-3 rounded-lg bg-muted text-muted-foreground text-sm border">
						公开注册已关闭。请填写有效邀请码，或联系管理员开启注册。
					</div>
				{/if}
				{#if error}
					<div class="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2.5 border border-destructive/20 animate-in fade-in slide-in-from-top-1 duration-200">
						<ShieldAlert class="size-4 shrink-0 mt-0.5" />
						<span>{error}</span>
					</div>
				{/if}

				<form onsubmit={handleSubmit} class="space-y-4">
					{#if bootstrapRequired}
						<div class="space-y-2"><Label for="admin-password">部署管理员密码 <span class="text-destructive">*</span></Label><Input id="admin-password" type="password" bind:value={adminPassword} autocomplete="current-password" disabled={loading} required /></div>
					{:else if invitationsAllowed}
						<div class="space-y-2"><Label for="invite-code">邀请码（可选）</Label><Input id="invite-code" bind:value={inviteCode} autocomplete="off" disabled={loading} /></div>
					{/if}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="email">电子邮件地址 <span class="text-destructive">*</span></Label>
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

						<div class="space-y-2">
							<Label for="name">您的姓名（可选）</Label>
							<div class="relative">
								<span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
									<User class="size-4" />
								</span>
								<Input
									id="name"
									type="text"
									placeholder="张三"
									bind:value={name}
									disabled={loading}
									class="pl-10"
								/>
							</div>
						</div>
					</div>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="password">主密码 <span class="text-destructive">*</span></Label>
							<div class="relative">
								<span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
									<KeyRound class="size-4" />
								</span>
								<Input
									id="password"
									type={showPassword ? "text" : "password"}
									placeholder="至少 8 位字符"
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

						<div class="space-y-2">
							<Label for="confirmPassword">确认主密码 <span class="text-destructive">*</span></Label>
							<div class="relative">
								<span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
									<KeyRound class="size-4" />
								</span>
								<Input
									id="confirmPassword"
									type={showConfirmPassword ? "text" : "password"}
									placeholder="请再次输入"
									bind:value={confirmPassword}
									disabled={loading}
									class="pl-10 pr-10"
									required
								/>
								<button
									type="button"
									class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
									onclick={() => (showConfirmPassword = !showConfirmPassword)}
								>
									{#if showConfirmPassword}
										<EyeOff class="size-4" />
									{:else}
										<Eye class="size-4" />
									{/if}
								</button>
							</div>
						</div>
					</div>

					<div class="space-y-2">
						<div class="flex items-center gap-1.5">
							<Label for="hint">密码提示问题（可选）</Label>
							<span class="group relative cursor-pointer text-slate-400 dark:text-slate-500 hover:text-slate-600">
								<Info class="size-4" />
								<span class="absolute left-1/2 bottom-full mb-1.5 hidden group-hover:block -translate-x-1/2 w-48 p-2 rounded bg-slate-900 text-white text-xs leading-normal shadow-lg text-center z-10">
									如果忘记了密码，提示将发到您的邮箱（服务端仅存储提示文本）。
								</span>
							</span>
						</div>
						<Input
							id="hint"
							type="text"
							placeholder="例如：我最喜欢的书的作者"
							bind:value={hint}
							disabled={loading}
						/>
					</div>

					<div class="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
						<Label for="iterations">PBKDF2 迭代次数</Label>
						<Input
							id="iterations"
							type="number"
							bind:value={iterations}
							min="100000"
							disabled={loading}
						/>
						<p class="text-xs text-slate-400 dark:text-slate-500">
							更高的次数意味着更强的防暴力破解能力，但设备导出密钥的时间会随之变长。推荐值为 600,000。
						</p>
					</div>

					<Button type="submit" class="w-full mt-2" disabled={loading || configLoading || !registrationAvailable || (bootstrapRequired && !adminPasswordConfigured)}>
						{#if loading}
							<div class="size-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2"></div>
							正在本地派生加密密钥...
						{:else}
							创建我的主密码库
						{/if}
					</Button>
				</form>
			{/if}
		</Card.Content>

		<Card.Footer class="flex flex-col items-center border-t border-slate-100 dark:border-slate-800 py-4 gap-2">
			<p class="text-sm text-slate-500">
				已有 Edgewarden 账号？
				<a href="/login" class="text-primary font-medium hover:underline">
					立即登录
				</a>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
