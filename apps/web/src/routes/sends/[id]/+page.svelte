<script lang="ts">
import { onMount } from "svelte";
import { page } from "$app/state";
import {
	accessSendPublicApi,
	requestSendFileDownloadApi,
} from "$lib/services/api-sends";
import { decryptBwFileData } from "$lib/services/crypto";
import {
	decodeSendShareKey,
	decryptPublicSend,
	type DecryptedPublicSend,
	type SendKeys,
} from "$lib/services/send-crypto";
import { ApiError } from "$lib/services/rpc";
import * as Alert from "$lib/components/ui/alert/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Empty from "$lib/components/ui/empty/index.js";
import * as Field from "$lib/components/ui/field/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Separator } from "$lib/components/ui/separator/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import {
	Share2,
	File,
	Lock,
	Copy,
	Check,
	Eye,
	EyeOff,
	ShieldAlert,
	ArrowDownToLine,
	LockOpen,
} from "@lucide/svelte";

// Params
const accessId = page.params.id || "";

// Cryptographic states
let sendEncKey = $state<Uint8Array | null>(null);
let sendMacKey = $state<Uint8Array | null>(null);
let sendKeys = $state<SendKeys | null>(null);

// UI/Data states
let loading = $state(true);
let error = $state("");
let passwordRequired = $state(false);
let accessPassword = $state("");
let showPassword = $state(false);

let sendData = $state<DecryptedPublicSend | null>(null);
let decryptedText = $state("");
let decryptedFileName = $state("");
let decryptedFileSizeName = $state("");
let fileDownloading = $state(false);
let copied = $state(false);

onMount(async () => {
	// Parse Send Key from URL hash
	const hash = window.location.hash.slice(1);
	if (!hash) {
		error =
			"链接无效：缺少解密钥匙。请确保您复制了完整的分享链接（包括 '#' 后面的字符）。";
		loading = false;
		return;
	}

	try {
		sendKeys = decodeSendShareKey(hash);
		sendEncKey = sendKeys.enc;
		sendMacKey = sendKeys.mac;
	} catch (e) {
		error = "密钥解析失败，请检查分享链接是否完整。";
		loading = false;
		return;
	}

	await loadPublicSend();
});

async function loadPublicSend() {
	loading = true;
	error = "";
	try {
		const payload: { password?: string } = {};
		if (accessPassword) {
			payload.password = accessPassword;
		}

		const res = await accessSendPublicApi(accessId, payload);
		if (!sendKeys) throw new Error("Send 解密密钥不可用");
		const decrypted = await decryptPublicSend(res, sendKeys);
		sendData = decrypted;
		passwordRequired = false;

		// Decrypt payload fields
		if (decrypted.type === 0) decryptedText = decrypted.text ?? "";
		if (decrypted.type === 1) {
			decryptedFileName = decrypted.file?.fileName || decrypted.name;
			decryptedFileSizeName = decrypted.file?.sizeName || "未知大小";
		}
	} catch (caught) {
		if (caught instanceof ApiError && caught.status === 401) {
			passwordRequired = true;
			if (accessPassword) {
				error = "密码错误，请重新输入。";
			}
		} else {
			error =
				(caught instanceof Error ? caught.message : "") ||
				"获取分享内容失败，此链接可能已失效、被禁用或不存在。";
		}
	} finally {
		loading = false;
	}
}

async function handleDownloadFile() {
	if (
		!sendData ||
		sendData.type !== 1 ||
		!sendData.file ||
		!sendEncKey ||
		!sendMacKey
	)
		return;
	const file = sendData.file;
	fileDownloading = true;
	error = "";

	try {
		// 1. Fetch a typed file access ticket through the Hono RPC client.
		const ticket = await requestSendFileDownloadApi(
			sendData.id,
			file.id,
			accessPassword ? { password: accessPassword } : {},
		);

		// 2. Download encrypted payload bytes
		const fileResp = await fetch(ticket.url);
		if (!fileResp.ok) {
			throw new Error(`下载文件失败: ${fileResp.status}`);
		}
		const encryptedBuffer = await fileResp.arrayBuffer();

		// 3. Decrypt file payload
		const decryptedBytes = await decryptBwFileData(
			new Uint8Array(encryptedBuffer),
			sendEncKey,
			sendMacKey,
		);

		// 4. Trigger download in browser
		const blob = new Blob([decryptedBytes as BlobPart], {
			type: "application/octet-stream",
		});
		const dlUrl = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = dlUrl;
		a.download = decryptedFileName || "downloaded-file";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(dlUrl);
	} catch (caught) {
		error = `下载或解密文件失败：${caught instanceof Error ? caught.message : String(caught)}`;
	} finally {
		fileDownloading = false;
	}
}

function handleCopyText() {
	navigator.clipboard.writeText(decryptedText);
	copied = true;
	setTimeout(() => (copied = false), 2000);
}
</script>

<svelte:head>
	<title>安全分享 - Edgewarden Send</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
	<Card.Root class="w-full max-w-lg shadow-xl">
		<Card.Header class="items-center gap-2 text-center">
			<div class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Share2 /></div>
			<Card.Title>Edgewarden Send</Card.Title>
			<Card.Description>安全、端到端加密、阅后即焚分享</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-6">

		{#if loading}
			<Empty.Root><Empty.Media variant="icon"><Spinner /></Empty.Media><Empty.Header><Empty.Title>正在建立端到端解密通道</Empty.Title><Empty.Description>正在安全获取并解密分享内容。</Empty.Description></Empty.Header></Empty.Root>
		{:else if error && !passwordRequired}
			<Alert.Root variant="destructive"><ShieldAlert /><Alert.Title>无法打开分享</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>
		{:else if passwordRequired}
			<form onsubmit={(e) => { e.preventDefault(); loadPublicSend(); }}>
				<Field.Group>
				<Alert.Root><Lock /><Alert.Title>此安全分享已启用密码保护</Alert.Title><Alert.Description>请输入发送者设置的访问密码以继续解锁密文。</Alert.Description></Alert.Root>

				{#if error}
					<Alert.Root variant="destructive"><ShieldAlert /><Alert.Description>{error}</Alert.Description></Alert.Root>
				{/if}

				<Field.Field>
					<Field.Label for="send-password">访问密码</Field.Label>
					<div class="relative">
						<Input
							id="send-password"
							type={showPassword ? "text" : "password"}
							bind:value={accessPassword}
							placeholder="输入访问密码"
							class="pr-10"
							required
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							class="absolute right-2 top-1/2 -translate-y-1/2"
							onclick={() => (showPassword = !showPassword)}
							aria-label={showPassword ? "隐藏密码" : "显示密码"}
						>
							{#if showPassword}<EyeOff />{:else}<Eye />{/if}
						</Button>
					</div>
				</Field.Field>

				<Button type="submit" class="w-full font-semibold">
					验证密码并解锁
				</Button>
				</Field.Group>
			</form>
		{:else if sendData}
			<div class="flex flex-col gap-4">
				<Alert.Root><LockOpen /><Alert.Title>解密成功</Alert.Title><Alert.Description>
						密钥仅保留在您的浏览器内存中。服务器已限制或将在到期后物理销毁此项。
				</Alert.Description></Alert.Root>

				{#if sendData.type === 0}
					<!-- Text Send payload -->
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between text-xs text-muted-foreground">
							<span>分享内容</span>
							<Button variant="ghost" size="sm" onclick={handleCopyText} class="h-7 text-xs gap-1">
								{#if copied}
									<Check class="size-3 text-green-500" />
									已复制
								{:else}
									<Copy class="size-3" />
									复制文本
								{/if}
							</Button>
						</div>
						<pre class="w-full select-all whitespace-pre-wrap break-all rounded-xl border bg-muted/50 p-4 font-mono text-sm leading-relaxed">{decryptedText}</pre>
					</div>
				{:else if sendData.type === 1}
					<!-- File Send payload -->
					<div class="flex flex-col items-center gap-4 rounded-2xl border bg-muted/30 p-5 text-center">
						<div class="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
							<File />
						</div>
						<div class="flex max-w-full flex-col gap-1">
							<h4 class="max-w-xs truncate text-base font-bold">{decryptedFileName}</h4>
							<p class="text-xs text-muted-foreground">{decryptedFileSizeName}</p>
						</div>
						<Button
							onclick={handleDownloadFile}
							disabled={fileDownloading}
							class="w-full font-semibold"
						>
							{#if fileDownloading}
								<Spinner data-icon="inline-start" />
								正在解密文件...
							{:else}
								<ArrowDownToLine data-icon="inline-start" />
								下载加密保护文件
							{/if}
						</Button>
					</div>
				{/if}

				{#if sendData.creatorIdentifier}
					<Separator />
					<p class="text-center text-xs text-muted-foreground">
						此链接由公开的 {sendData.creatorIdentifier} 签名提供
					</p>
				{/if}
			</div>
		{/if}
		</Card.Content>
	</Card.Root>
</div>
