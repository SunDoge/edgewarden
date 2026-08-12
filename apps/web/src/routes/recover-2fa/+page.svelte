<script lang="ts">
import { goto } from "$app/navigation";
import { recoverTwoFactorApi } from "$lib/services/api";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Label } from "$lib/components/ui/label/index.js";
import * as Card from "$lib/components/ui/card/index.js";
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
			value instanceof Error ? value.message : "恢复失败，请检查凭据和恢复代码";
	} finally {
		password = "";
		loading = false;
	}
}
</script>

<svelte:head><title>恢复两步验证 · Edgewarden</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header><div class="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound /></div><Card.Title>恢复两步验证</Card.Title><Card.Description>使用主密码和一次性恢复代码关闭当前两步验证。成功后所有现有会话都会失效。</Card.Description></Card.Header>
		<Card.Content>
			{#if error}<div role="alert" class="mb-4 flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><ShieldAlert class="size-4 shrink-0" />{error}</div>{/if}
			<form class="space-y-4" onsubmit={submit}>
				<div class="space-y-2"><Label for="recover-email">电子邮件</Label><Input id="recover-email" type="email" bind:value={email} autocomplete="email" required /></div>
				<div class="space-y-2"><Label for="recover-password">主密码</Label><Input id="recover-password" type="password" bind:value={password} autocomplete="current-password" required /></div>
				<div class="space-y-2"><Label for="recover-code">恢复代码</Label><Input id="recover-code" bind:value={recoveryCode} autocomplete="one-time-code" autocapitalize="characters" maxlength={64} required /></div>
				<Button class="w-full" type="submit" disabled={loading || !email || !password || recoveryCode.length < 8}>{loading ? "正在恢复…" : "关闭两步验证"}</Button>
			</form>
		</Card.Content>
		<Card.Footer><Button variant="link" class="px-0" onclick={() => goto("/login")}>返回登录</Button></Card.Footer>
	</Card.Root>
</main>
