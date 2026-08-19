<script lang="ts">
import { ShieldCheck } from "@lucide/svelte";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import AccountPasskeys from "./AccountPasskeys.svelte";
import AuthRequestSettings from "./AuthRequestSettings.svelte";
import TwoFactorPasskeys from "./TwoFactorPasskeys.svelte";
import YubikeySettings from "./YubikeySettings.svelte";

let {
	profile,
	isAdmin,
	recoveryCode,
	busy,
	onCopy,
	onChangePassword,
	onShowRecoveryCode,
	onDisableTwoFactor,
	onBeginTotp,
	onMessage,
	onError,
}: {
	profile: {
		email: string;
		kdfIterations: number;
		twoFactorEnabled: boolean;
	};
	isAdmin: boolean;
	recoveryCode: string;
	busy: string;
	onCopy: (value: string) => void | Promise<void>;
	onChangePassword: () => void;
	onShowRecoveryCode: () => void | Promise<void>;
	onDisableTwoFactor: () => void;
	onBeginTotp: () => void | Promise<void>;
	onMessage: (value: string) => void;
	onError: (value: unknown) => void;
} = $props();
</script>

<div class="flex flex-col gap-6">
	<Card.Root>
		<Card.Header><Card.Title>主密码</Card.Title><Card.Description>更改后会重新保护保险库密钥，并退出所有设备。</Card.Description></Card.Header>
		<Card.Content><Button variant="outline" onclick={onChangePassword}>更改主密码</Button></Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>两步验证</Card.Title><Card.Description>使用兼容 TOTP 的身份验证器保护登录。</Card.Description></Card.Header>
		<Card.Content class="flex flex-col gap-4">
			<div class="flex items-center gap-2"><Badge variant={profile.twoFactorEnabled ? "default" : "secondary"}>{profile.twoFactorEnabled ? "已启用" : "未启用"}</Badge></div>
			{#if recoveryCode}<div class="flex gap-2"><Input value={recoveryCode} readonly class="font-mono" /><Button variant="outline" size="icon" onclick={() => onCopy(recoveryCode)} aria-label="复制恢复代码">复制</Button></div>{/if}
			<div class="flex flex-wrap gap-2">
				{#if profile.twoFactorEnabled}<Button variant="outline" onclick={onShowRecoveryCode} disabled={busy === "recovery"}>查看恢复代码</Button><Button variant="destructive" onclick={onDisableTwoFactor}>关闭两步验证</Button>{:else}<Button onclick={onBeginTotp} disabled={busy === "totp"}><ShieldCheck data-icon="inline-start" />设置身份验证器</Button>{/if}
			</div>
		</Card.Content>
	</Card.Root>

	<TwoFactorPasskeys email={profile.email} kdfIterations={profile.kdfIterations} {onMessage} {onError} />
	<YubikeySettings email={profile.email} kdfIterations={profile.kdfIterations} {isAdmin} {onMessage} {onError} />
	<AccountPasskeys email={profile.email} kdfIterations={profile.kdfIterations} {onMessage} {onError} />
	<AuthRequestSettings email={profile.email} {onMessage} {onError} />
</div>
