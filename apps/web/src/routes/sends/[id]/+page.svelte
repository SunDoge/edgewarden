<script lang="ts">
import { onMount } from "svelte";
import { page } from "$app/state";
import {
	accessSendPublicApi,
	requestSendFileDownloadApi,
} from "$lib/services/api";
import { decryptBwFileData } from "$lib/services/crypto";
import {
	decodeSendShareKey,
	decryptPublicSend,
	type SendKeys,
} from "$lib/services/send-crypto";
import { ApiError } from "$lib/services/rpc";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import {
	Share2,
	FileText,
	File,
	Lock,
	Download,
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

let sendData = $state<any | null>(null);
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
		const payload: any = {};
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
	} catch (e: any) {
		if (e instanceof ApiError && e.status === 401) {
			passwordRequired = true;
			if (accessPassword) {
				error = "密码错误，请重新输入。";
			}
		} else {
			error =
				e.message || "获取分享内容失败，此链接可能已失效、被禁用或不存在。";
		}
	} finally {
		loading = false;
	}
}

async function handleDownloadFile() {
	if (!sendData || sendData.type !== 1 || !sendEncKey || !sendMacKey) return;
	fileDownloading = true;
	error = "";

	try {
		// 1. Fetch a typed file access ticket through the Hono RPC client.
		const ticket = await requestSendFileDownloadApi(
			sendData.id,
			sendData.file.id,
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
		const blob = new Blob([decryptedBytes as any], {
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
	} catch (e: any) {
		error = "下载或解密文件失败：" + (e.message || e);
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

<div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
	<div class="w-full max-w-lg bg-white dark:bg-slate-900 shadow-xl border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden p-6 space-y-6">
		<div class="text-center space-y-2">
			<div class="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2">
				<Share2 class="size-6" />
			</div>
			<h2 class="text-xl font-bold text-slate-800 dark:text-slate-100">Edgewarden Send</h2>
			<p class="text-xs text-slate-400">安全、端到端加密、阅后即焚分享</p>
		</div>

		{#if loading}
			<div class="p-8 text-center text-slate-500">
				<div class="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-3"></div>
				<span class="text-sm font-semibold">正在建立端到端解密通道...</span>
			</div>
		{:else if error && !passwordRequired}
			<div class="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2.5">
				<ShieldAlert class="size-4 shrink-0 mt-0.5" />
				<span>{error}</span>
			</div>
		{:else if passwordRequired}
			<form onsubmit={(e) => { e.preventDefault(); loadPublicSend(); }} class="space-y-4">
				<div class="p-4 bg-slate-50 dark:bg-slate-850 border border-slate-150 dark:border-slate-800 rounded-xl space-y-2">
					<div class="flex items-center gap-2 text-slate-650 text-sm font-semibold">
						<Lock class="size-4 text-slate-500" />
						<span>此安全分享已启用密码保护</span>
					</div>
					<p class="text-xs text-slate-400">请输入发送者设置的访问密码以继续解锁密文。</p>
				</div>

				{#if error}
					<div class="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
						{error}
					</div>
				{/if}

				<div class="space-y-1.5">
					<div class="relative">
						<Input
							type={showPassword ? "text" : "password"}
							bind:value={accessPassword}
							placeholder="输入访问密码"
							class="pr-10"
							required
						/>
						<button
							type="button"
							class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650"
							onclick={() => (showPassword = !showPassword)}
						>
							{#if showPassword}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
						</button>
					</div>
				</div>

				<Button type="submit" class="w-full font-semibold">
					验证密码并解锁
				</Button>
			</form>
		{:else if sendData}
			<div class="space-y-4">
				<div class="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-250 dark:border-emerald-900 rounded-xl space-y-1">
					<div class="flex items-center gap-2 text-emerald-650 text-sm font-semibold">
						<LockOpen class="size-4 text-emerald-500" />
						<span>解密成功</span>
					</div>
					<p class="text-[11px] text-slate-400">
						密钥仅保留在您的浏览器内存中。服务器已限制或将在到期后物理销毁此项。
					</p>
				</div>

				{#if sendData.type === 0}
					<!-- Text Send payload -->
					<div class="space-y-2">
						<div class="flex justify-between items-center text-xs text-slate-400">
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
						<pre class="w-full p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm whitespace-pre-wrap leading-relaxed select-all font-mono break-all">{decryptedText}</pre>
					</div>
				{:else if sendData.type === 1}
					<!-- File Send payload -->
					<div class="p-5 border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-900/50 flex flex-col items-center text-center space-y-4">
						<div class="w-14 h-14 bg-primary/10 text-primary flex items-center justify-center rounded-2xl">
							<File class="size-7" />
						</div>
						<div class="space-y-1">
							<h4 class="font-bold text-base text-slate-800 dark:text-slate-100 max-w-xs truncate">{decryptedFileName}</h4>
							<p class="text-xs text-slate-400">{decryptedFileSizeName}</p>
						</div>
						<Button
							onclick={handleDownloadFile}
							disabled={fileDownloading}
							class="w-full font-semibold gap-2 py-3 bg-primary text-primary-foreground"
						>
							{#if fileDownloading}
								<div class="size-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
								正在解密文件...
							{:else}
								<ArrowDownToLine class="size-4" />
								下载加密保护文件
							{/if}
						</Button>
					</div>
				{/if}

				{#if sendData.creatorIdentifier}
					<p class="text-center text-[10px] text-slate-400 mt-4">
						此链接由公开的 {sendData.creatorIdentifier} 签名提供
					</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
