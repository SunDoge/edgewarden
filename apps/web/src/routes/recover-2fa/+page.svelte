<script lang="ts">
import { goto } from "$app/navigation";
import { recoverTwoFactorApi } from "$lib/services/api-auth";
import { Button } from "$lib/components/ui/button/index.js";
import * as Alert from "$lib/components/ui/alert/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
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
			{#if error}<Alert.Root variant="destructive" class="mb-4"><ShieldAlert /><Alert.Title>恢复失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
			<form onsubmit={submit}><Field.Group>
				<Field.Field><Field.Label for="recover-email">电子邮件</Field.Label><Input id="recover-email" type="email" bind:value={email} autocomplete="email" required /></Field.Field>
				<Field.Field><Field.Label for="recover-password">主密码</Field.Label><Input id="recover-password" type="password" bind:value={password} autocomplete="current-password" required /></Field.Field>
				<Field.Field><Field.Label for="recover-code">恢复代码</Field.Label><Input id="recover-code" bind:value={recoveryCode} autocomplete="one-time-code" autocapitalize="characters" maxlength={64} required /></Field.Field>
				<Button class="w-full" type="submit" disabled={loading || !email || !password || recoveryCode.length < 8}>{#if loading}<Spinner data-icon="inline-start" />正在恢复…{:else}关闭两步验证{/if}</Button>
			</Field.Group></form>
		</Card.Content>
		<Card.Footer><Button variant="link" class="px-0" onclick={() => goto("/login")}>返回登录</Button></Card.Footer>
	</Card.Root>
</main>
