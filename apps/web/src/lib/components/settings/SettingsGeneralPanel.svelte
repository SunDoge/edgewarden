<script lang="ts">
import { Copy, KeyRound, RefreshCw } from "@lucide/svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Select from "$lib/components/ui/select/index.js";

let {
	email,
	theme = $bindable(),
	lockTimeoutMinutes = $bindable(),
	sessionTimeoutAction = $bindable(),
	name = $bindable(),
	hint = $bindable(),
	apiKey,
	busy,
	onSavePreferences,
	onSaveProfile,
	onCopy,
	onRevealApiKey,
	onRotateApiKey,
}: {
	email: string;
	theme: "system" | "light" | "dark";
	lockTimeoutMinutes: string;
	sessionTimeoutAction: "lock" | "logout";
	name: string;
	hint: string;
	apiKey: string;
	busy: string;
	onSavePreferences: () => void;
	onSaveProfile: () => void | Promise<void>;
	onCopy: (value: string) => void | Promise<void>;
	onRevealApiKey: () => void | Promise<void>;
	onRotateApiKey: () => void;
} = $props();
</script>

<div class="flex flex-col gap-6">
	<Card.Root>
		<Card.Header><Card.Title>外观与会话</Card.Title><Card.Description>偏好仅保存在此浏览器，不包含密码或保险库密钥。</Card.Description></Card.Header>
		<Card.Content>
			<Field.Group>
				<Field.Field><Field.Label>主题</Field.Label><Select.Root type="single" bind:value={theme}><Select.Trigger>{theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="system">跟随系统</Select.Item><Select.Item value="light">浅色</Select.Item><Select.Item value="dark">深色</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field>
				<Field.Field><Field.Label>无操作后</Field.Label><Select.Root type="single" bind:value={lockTimeoutMinutes}><Select.Trigger>{lockTimeoutMinutes === "0" ? "永不" : `${lockTimeoutMinutes} 分钟`}</Select.Trigger><Select.Content><Select.Group><Select.Item value="1">1 分钟</Select.Item><Select.Item value="5">5 分钟</Select.Item><Select.Item value="15">15 分钟</Select.Item><Select.Item value="30">30 分钟</Select.Item><Select.Item value="0">永不</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field>
				<Field.Field><Field.Label>超时操作</Field.Label><Select.Root type="single" bind:value={sessionTimeoutAction}><Select.Trigger>{sessionTimeoutAction === "lock" ? "锁定保险库" : "退出登录"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="lock">锁定保险库</Select.Item><Select.Item value="logout">退出登录并清除离线缓存</Select.Item></Select.Group></Select.Content></Select.Root><Field.Description>“锁定”保留加密离线缓存；“退出”会同时清除缓存和令牌。</Field.Description></Field.Field>
				<Field.Field orientation="horizontal"><Button onclick={onSavePreferences}>保存偏好</Button></Field.Field>
			</Field.Group>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>个人资料</Card.Title><Card.Description>{email}</Card.Description></Card.Header>
		<Card.Content>
			<form onsubmit={(event) => { event.preventDefault(); void onSaveProfile(); }}>
				<Field.Group>
					<Field.Field><Field.Label for="name">显示名称</Field.Label><Input id="name" bind:value={name} autocomplete="name" /></Field.Field>
					<Field.Field><Field.Label for="hint">主密码提示</Field.Label><Input id="hint" bind:value={hint} /><Field.Description>提示不会通过此页面直接显示给未登录用户。</Field.Description></Field.Field>
					<Field.Field orientation="horizontal"><Button type="submit" disabled={busy === "profile"}>{busy === "profile" ? "保存中…" : "保存资料"}</Button></Field.Field>
				</Field.Group>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>API Key</Card.Title><Card.Description>用于受信任的客户端集成，请勿公开。</Card.Description></Card.Header>
		<Card.Content class="flex flex-col gap-3">
			{#if apiKey}<div class="flex gap-2"><Input value={apiKey} readonly class="font-mono" /><Button variant="outline" size="icon" onclick={() => onCopy(apiKey)} aria-label="复制 API Key"><Copy data-icon /></Button></div>{/if}
			<div class="flex flex-wrap gap-2"><Button variant="outline" onclick={onRevealApiKey} disabled={busy === "api-key"}><KeyRound data-icon="inline-start" />{apiKey ? "重新读取" : "显示 API Key"}</Button><Button variant="outline" onclick={onRotateApiKey} disabled={busy === "api-key"}><RefreshCw data-icon="inline-start" />轮换</Button></div>
		</Card.Content>
	</Card.Root>
</div>
