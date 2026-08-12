<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Tabs from "$lib/components/ui/tabs/index.js";
import * as Select from "$lib/components/ui/select/index.js";
import { Textarea } from "$lib/components/ui/textarea/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import {
	estimateBits,
	generateEmailAlias,
	generatePassphrase,
	generatePassword,
	generatePin,
	generateUsername,
	type GeneratorMode,
} from "$lib/services/password-generator";
import {
	generateSshKey,
	type GeneratedSshKey,
} from "$lib/services/ssh-key-generator";
import { ArrowLeft, Check, Copy, Download, RefreshCw } from "@lucide/svelte";
import { match } from "ts-pattern";

let mode = $state<GeneratorMode>("password");
let value = $state("");
let error = $state("");
let copied = $state(false);
let length = $state(20);
let uppercase = $state(true);
let lowercase = $state(true);
let numbers = $state(true);
let special = $state(true);
let avoidAmbiguous = $state(false);
let minUppercase = $state(1);
let minLowercase = $state(1);
let minNumbers = $state(1);
let minSpecial = $state(1);
let words = $state(5);
let separator = $state("-");
let capitalize = $state(false);
let includeNumber = $state(true);
let useCustomWords = $state(false);
let customWords = $state("");
let usernameCustomWord = $state("");
let pinLength = $state(6);
let email = $state("");
let aliasMode = $state<"plus" | "catchall" | "subdomain">("plus");
let aliasDomain = $state("");
let sshType = $state<"ed25519" | "rsa">("ed25519");
let rsaLength = $state("3072");
let sshComment = $state("");
let sshKey = $state<GeneratedSshKey | null>(null);
let generating = $state(false);
let bits = $derived(estimateBits(value, mode));

async function generate() {
	error = "";
	copied = false;
	generating = true;
	try {
		if (mode === "ssh") {
			sshKey = await generateSshKey({
				type: sshType,
				rsaLength: Number(rsaLength) as 2048 | 3072 | 4096,
				comment: sshComment,
			});
			value = sshKey.publicKey;
			return;
		}
		value = match(mode)
			.with("password", () =>
				generatePassword({
					length,
					uppercase,
					lowercase,
					numbers,
					special,
					avoidAmbiguous,
					minUppercase,
					minLowercase,
					minNumbers,
					minSpecial,
				}),
			)
			.with("passphrase", () =>
				generatePassphrase({
					words,
					separator,
					capitalize,
					includeNumber,
					customWords: useCustomWords ? customWords : undefined,
				}),
			)
			.with("pin", () => generatePin(pinLength))
			.with("username", () =>
				generateUsername({
					words,
					separator,
					capitalize,
					includeNumber,
					customWords: useCustomWords ? customWords : undefined,
					customWord: usernameCustomWord,
				}),
			)
			.with("email", () =>
				generateEmailAlias({ email, mode: aliasMode, domain: aliasDomain }),
			)
			.exhaustive();
	} catch (e) {
		error = e instanceof Error ? e.message : "生成失败";
	} finally {
		generating = false;
	}
}

function changeMode(next: string) {
	mode = next as GeneratorMode;
	value = "";
	sshKey = null;
	error = "";
}

async function copy(text = value) {
	if (!text) return;
	await navigator.clipboard.writeText(text);
	copied = true;
	setTimeout(() => (copied = false), 1500);
}

function download(filename: string, text: string) {
	const url = URL.createObjectURL(
		new Blob([text], { type: "text/plain;charset=utf-8" }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

const settingsKey = "edgewarden.password-generator.v1";
onMount(() => {
	try {
		const saved = JSON.parse(localStorage.getItem(settingsKey) ?? "null");
		if (saved && typeof saved === "object") {
			mode = saved.mode ?? mode;
			length = saved.length ?? length;
			uppercase = saved.uppercase ?? uppercase;
			lowercase = saved.lowercase ?? lowercase;
			numbers = saved.numbers ?? numbers;
			special = saved.special ?? special;
			avoidAmbiguous = saved.avoidAmbiguous ?? avoidAmbiguous;
			minUppercase = saved.minUppercase ?? minUppercase;
			minLowercase = saved.minLowercase ?? minLowercase;
			minNumbers = saved.minNumbers ?? minNumbers;
			minSpecial = saved.minSpecial ?? minSpecial;
			words = saved.words ?? words;
			separator = saved.separator ?? separator;
			capitalize = saved.capitalize ?? capitalize;
			includeNumber = saved.includeNumber ?? includeNumber;
			useCustomWords = saved.useCustomWords ?? useCustomWords;
			customWords = saved.customWords ?? customWords;
			usernameCustomWord = saved.usernameCustomWord ?? usernameCustomWord;
			pinLength = saved.pinLength ?? pinLength;
			email = saved.email ?? email;
			aliasMode = saved.aliasMode ?? aliasMode;
			aliasDomain = saved.aliasDomain ?? aliasDomain;
			sshType = saved.sshType ?? sshType;
			rsaLength = saved.rsaLength ?? rsaLength;
			sshComment = saved.sshComment ?? sshComment;
			value = "";
			void generate();
		}
	} catch {
		/* malformed preferences use safe defaults */
	}
});

$effect(() => {
	if (typeof window === "undefined") return;
	localStorage.setItem(
		settingsKey,
		JSON.stringify({
			mode,
			length,
			uppercase,
			lowercase,
			numbers,
			special,
			avoidAmbiguous,
			minUppercase,
			minLowercase,
			minNumbers,
			minSpecial,
			words,
			separator,
			capitalize,
			includeNumber,
			useCustomWords,
			customWords,
			usernameCustomWord,
			pinLength,
			email,
			aliasMode,
			aliasDomain,
			sshType,
			rsaLength,
			sshComment,
		}),
	);
});

$effect(() => {
	if (!value && mode !== "email") void generate();
});
</script>

<svelte:head><title>密码生成器 · Edgewarden</title></svelte:head>

<main class="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-8">
	<header class="flex items-center gap-3"><Button variant="ghost" size="icon" onclick={() => goto("/vault")} aria-label="返回保险库"><ArrowLeft /></Button><div><h1 class="text-2xl font-semibold">密码生成器</h1><p class="text-sm text-muted-foreground">所有内容仅在本机使用加密随机数生成。</p></div></header>

	<Tabs.Root value={mode} onValueChange={changeMode}>
		<Tabs.List class="grid h-auto grid-cols-2 md:grid-cols-6">
			<Tabs.Trigger value="password">密码</Tabs.Trigger><Tabs.Trigger value="passphrase">密码短语</Tabs.Trigger><Tabs.Trigger value="pin">PIN</Tabs.Trigger><Tabs.Trigger value="username">用户名</Tabs.Trigger><Tabs.Trigger value="email">邮箱别名</Tabs.Trigger><Tabs.Trigger value="ssh">SSH 密钥</Tabs.Trigger>
		</Tabs.List>

		<Card.Root>
			<Card.Header><Card.Title>生成结果</Card.Title><Card.Description>{bits ? `估算熵：${bits} bits` : "调整选项后生成"}</Card.Description></Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#if mode === "ssh" && sshKey}<Field.Group><Field.Field><Field.Label for="ssh-public">公钥</Field.Label><Textarea id="ssh-public" value={sshKey.publicKey} readonly rows={3} class="font-mono text-xs" /><div class="flex gap-2"><Button variant="outline" onclick={() => copy(sshKey?.publicKey)}><Copy data-icon="inline-start" />复制公钥</Button><Button variant="outline" onclick={() => download("id_edgewarden.pub", `${sshKey?.publicKey}\n`)}><Download data-icon="inline-start" />下载</Button></div></Field.Field><Field.Field><Field.Label for="ssh-private">私钥</Field.Label><Textarea id="ssh-private" value={sshKey.privateKey} readonly rows={10} class="font-mono text-xs" /><div class="flex gap-2"><Button variant="outline" onclick={() => copy(sshKey?.privateKey)}><Copy data-icon="inline-start" />复制私钥</Button><Button variant="outline" onclick={() => download("id_edgewarden", sshKey?.privateKey ?? "")}><Download data-icon="inline-start" />下载</Button></div></Field.Field><Field.Field><Field.Label for="ssh-fingerprint">指纹</Field.Label><Input id="ssh-fingerprint" value={sshKey.fingerprint} readonly class="font-mono" /></Field.Field></Field.Group>{:else}<div class="flex gap-2"><Input value={value} readonly class="font-mono" placeholder={mode === "email" ? "请先填写邮箱或域名" : ""} /><Button variant="outline" size="icon" onclick={() => copy()} disabled={!value} aria-label="复制结果">{#if copied}<Check />{:else}<Copy />{/if}</Button></div>{/if}
				{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
				<Button onclick={generate} disabled={generating}><RefreshCw class={generating ? "animate-spin" : undefined} data-icon="inline-start" />{generating ? "正在生成…" : "重新生成"}</Button>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title>选项</Card.Title></Card.Header>
			<Card.Content>
				<Field.Group>
					{#if mode === "password"}
						<Field.Field><Field.Label for="length">长度</Field.Label><Input id="length" type="number" min={4} max={128} bind:value={length} /></Field.Field>
						{#each [["大写字母", "uppercase"], ["小写字母", "lowercase"], ["数字", "numbers"], ["特殊字符", "special"], ["避免易混淆字符", "ambiguous"]] as option}
							<Field.Field orientation="horizontal"><Field.Content><Field.Label>{option[0]}</Field.Label></Field.Content><Switch checked={option[1] === "uppercase" ? uppercase : option[1] === "lowercase" ? lowercase : option[1] === "numbers" ? numbers : option[1] === "special" ? special : avoidAmbiguous} onCheckedChange={(checked) => { if (option[1] === "uppercase") uppercase = checked; else if (option[1] === "lowercase") lowercase = checked; else if (option[1] === "numbers") numbers = checked; else if (option[1] === "special") special = checked; else avoidAmbiguous = checked; }} /></Field.Field>
						{/each}
						<div class="grid grid-cols-2 gap-3">{#if uppercase}<Field.Field><Field.Label>最少大写</Field.Label><Input type="number" min={1} max={9} bind:value={minUppercase} /></Field.Field>{/if}{#if lowercase}<Field.Field><Field.Label>最少小写</Field.Label><Input type="number" min={1} max={9} bind:value={minLowercase} /></Field.Field>{/if}{#if numbers}<Field.Field><Field.Label>最少数字</Field.Label><Input type="number" min={1} max={9} bind:value={minNumbers} /></Field.Field>{/if}{#if special}<Field.Field><Field.Label>最少特殊字符</Field.Label><Input type="number" min={1} max={9} bind:value={minSpecial} /></Field.Field>{/if}</div>
					{:else if mode === "passphrase" || mode === "username"}
						<Field.Field><Field.Label for="words">单词数量</Field.Label><Input id="words" type="number" min={mode === "username" ? 1 : 3} max={20} bind:value={words} /></Field.Field>
						<Field.Field><Field.Label for="separator">分隔符</Field.Label><Input id="separator" maxlength={1} bind:value={separator} /></Field.Field>
						<Field.Field orientation="horizontal"><Field.Content><Field.Label>首字母大写</Field.Label></Field.Content><Switch bind:checked={capitalize} /></Field.Field>
						<Field.Field orientation="horizontal"><Field.Content><Field.Label>包含数字</Field.Label></Field.Content><Switch bind:checked={includeNumber} /></Field.Field>
						<Field.Field orientation="horizontal"><Field.Content><Field.Label>使用自定义词表</Field.Label></Field.Content><Switch bind:checked={useCustomWords} /></Field.Field>
						{#if useCustomWords}<Field.Field><Field.Label for="custom-words">自定义单词（空白或逗号分隔）</Field.Label><Textarea id="custom-words" rows={6} bind:value={customWords} /></Field.Field>{/if}
						{#if mode === "username"}<Field.Field><Field.Label for="username-prefix">固定词</Field.Label><Input id="username-prefix" maxlength={128} bind:value={usernameCustomWord} /></Field.Field>{/if}
					{:else if mode === "pin"}
						<Field.Field><Field.Label for="pin-length">PIN 长度</Field.Label><Input id="pin-length" type="number" min={3} max={64} bind:value={pinLength} /></Field.Field>
					{:else if mode === "email"}
						<Field.Field><Field.Label for="alias-mode">别名类型</Field.Label><select id="alias-mode" bind:value={aliasMode} class="h-9 rounded-md border bg-transparent px-3 text-sm"><option value="plus">Plus Addressing</option><option value="catchall">Catch-all 域名</option><option value="subdomain">子域名</option></select></Field.Field>
						{#if aliasMode === "catchall"}<Field.Field><Field.Label for="alias-domain">域名</Field.Label><Input id="alias-domain" bind:value={aliasDomain} placeholder="example.com" /></Field.Field>{:else}<Field.Field><Field.Label for="alias-email">邮箱地址</Field.Label><Input id="alias-email" type="email" bind:value={email} placeholder="me@example.com" /></Field.Field>{/if}
					{:else}
						<Field.Field><Field.Label>密钥类型</Field.Label><Select.Root type="single" bind:value={sshType}><Select.Trigger>{sshType === "ed25519" ? "Ed25519（推荐）" : "RSA"}</Select.Trigger><Select.Content><Select.Group><Select.Item value="ed25519">Ed25519</Select.Item><Select.Item value="rsa">RSA</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field>
						{#if sshType === "rsa"}<Field.Field><Field.Label>RSA 长度</Field.Label><Select.Root type="single" bind:value={rsaLength}><Select.Trigger>{rsaLength} bits</Select.Trigger><Select.Content><Select.Group><Select.Item value="2048">2048</Select.Item><Select.Item value="3072">3072</Select.Item><Select.Item value="4096">4096</Select.Item></Select.Group></Select.Content></Select.Root></Field.Field>{/if}
						<Field.Field><Field.Label for="ssh-comment">注释</Field.Label><Input id="ssh-comment" bind:value={sshComment} placeholder="name@example.com" /></Field.Field>
					{/if}
				</Field.Group>
			</Card.Content>
		</Card.Root>
	</Tabs.Root>
</main>
