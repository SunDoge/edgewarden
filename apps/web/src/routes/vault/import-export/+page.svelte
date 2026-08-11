<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { vault, syncVaultData } from "$lib/stores/vault.svelte";
import { importCiphersApi } from "$lib/services/api";
import {
	buildBitwardenCsv,
	buildBitwardenJson,
	buildPlainExportDocument,
	encryptTransferDocument,
	inspectEncryptedVaultImport,
	parseVaultImport,
	parseVaultImportFile,
	type TransferDocument,
} from "$lib/services/vault-transfer";
import { Button } from "$lib/components/ui/button/index.js";
import {
	ArrowLeft,
	Download,
	Upload,
	ShieldAlert,
	FileCode,
	CheckCircle,
} from "@lucide/svelte";

let errorMsg = $state("");
let successMsg = $state("");
let importing = $state(false);
let files = $state<FileList | null>(null);
let importFormat = $state<"json" | "csv">("json");
let exportFormat = $state<"json" | "csv">("json");
let pendingImport = $state<TransferDocument | null>(null);
let encryptedImport = $state(false);
let importPassword = $state("");
const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

onMount(() => {
	if (!vault.isUnlocked) {
		goto("/vault/unlock");
	}
});

// Client-side export function
function handleExport() {
	errorMsg = "";
	successMsg = "";

	if (
		!confirm(
			"确定要导出所有保险库项吗？\n警告：导出的文件内容为未加密明文，请妥善保管！",
		)
	) {
		return;
	}

	try {
		const exportData = buildPlainExportDocument(vault.folders, vault.ciphers);
		const content =
			exportFormat === "csv"
				? buildBitwardenCsv(exportData)
				: buildBitwardenJson(exportData);
		const blob = new Blob([content], {
			type:
				exportFormat === "csv" ? "text/csv;charset=utf-8" : "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `edgewarden-export-${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
		a.click();
		URL.revokeObjectURL(url);

		successMsg = "导出成功！明文备份文件已下载。请妥善保存该文件。";
	} catch (e: any) {
		errorMsg = "导出失败: " + (e.message || e);
	}
}

async function prepareImport() {
	errorMsg = "";
	pendingImport = null;
	encryptedImport = false;
	importPassword = "";
	if (!files?.[0]) return;
	if (files[0].size > MAX_IMPORT_BYTES) {
		errorMsg = "导入文件不能超过 32 MiB。";
		return;
	}
	try {
		const text = await files[0].text();
		if (importFormat === "json") {
			const encryptedType = inspectEncryptedVaultImport(text);
			if (encryptedType === "account-restricted")
				throw new Error(
					"账户限制型加密 JSON 不能跨服务器导入，请改用密码保护型加密导出",
				);
			if (encryptedType === "password-protected") {
				encryptedImport = true;
				return;
			}
		}
		pendingImport = parseVaultImport(text, importFormat);
	} catch (e) {
		errorMsg = "解析失败: " + (e instanceof Error ? e.message : e);
	}
}

function resetImportSelection() {
	files = null;
	pendingImport = null;
	encryptedImport = false;
	importPassword = "";
	errorMsg = "";
}

// Client-side import function
async function handleImport() {
	errorMsg = "";
	successMsg = "";

	if (!files || files.length === 0) {
		errorMsg = "请先选择需要导入的 Bitwarden JSON 导出文件。";
		return;
	}

	importing = true;
	try {
		const importedData =
			pendingImport ??
			(await parseVaultImportFile(
				await files[0].text(),
				importFormat,
				importPassword,
			));
		if (importedData.folders.length === 0 && importedData.items.length === 0) {
			throw new Error("导入的文件中没有发现任何文件夹或密码项。");
		}

		if (!vault.symEncKey || !vault.symMacKey) {
			throw new Error("加密密钥未就绪，请重新解锁保险库。");
		}

		const encryptedPayload = await encryptTransferDocument(
			importedData,
			vault.symEncKey,
			vault.symMacKey,
		);
		await importCiphersApi(encryptedPayload);

		// 4. Reload local vault data
		await syncVaultData();

		successMsg = `导入成功！已成功导入 ${encryptedPayload.folders.length} 个文件夹和 ${encryptedPayload.ciphers.length} 个密码项。`;
		files = null;
		pendingImport = null;
		encryptedImport = false;
		importPassword = "";
	} catch (e: any) {
		errorMsg = "导入失败: " + (e.message || e);
	} finally {
		importing = false;
	}
}
</script>

<svelte:head>
	<title>数据导入与导出 - Edgewarden</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
	<header class="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between shrink-0">
		<div class="flex items-center gap-2.5">
			<Button variant="ghost" size="icon" onclick={() => goto("/vault")} class="size-8 rounded-lg">
				<ArrowLeft class="size-4" />
			</Button>
			<span class="font-bold text-lg text-slate-800 dark:text-slate-100">数据导入与导出</span>
		</div>
	</header>

	<main class="flex-1 p-6 md:p-8 max-w-4xl w-full mx-auto space-y-6">
		{#if errorMsg}
			<div class="p-4 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900/50 flex items-start gap-3">
				<ShieldAlert class="size-5 shrink-0 mt-0.5" />
				<div>
					<h4 class="font-bold text-sm">操作失败</h4>
					<p class="text-xs mt-1">{errorMsg}</p>
				</div>
			</div>
		{/if}

		{#if successMsg}
			<div class="p-4 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-900/50 flex items-start gap-3">
				<CheckCircle class="size-5 shrink-0 mt-0.5" />
				<div>
					<h4 class="font-bold text-sm">操作成功</h4>
					<p class="text-xs mt-1">{successMsg}</p>
				</div>
			</div>
		{/if}

		<div class="grid md:grid-cols-2 gap-6">
			<!-- Import Panel -->
			<section class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
						<Upload class="size-5" />
					</div>
					<div>
						<h3 class="font-bold text-slate-800 dark:text-slate-100">导入密码数据</h3>
						<p class="text-xs text-slate-400">导入 Bitwarden JSON 或 CSV</p>
					</div>
				</div>

				<hr class="border-slate-100 dark:border-slate-850" />

				<div class="space-y-4">
					<div class="space-y-1.5">
						<span class="text-xs font-semibold text-slate-400">导入格式</span>
						<div class="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center gap-3">
							<FileCode class="size-8 text-primary" />
							<div>
								<p class="text-sm font-semibold text-slate-800 dark:text-slate-200">Bitwarden Vault 导出</p>
								<p class="text-[10px] text-slate-400">支持密码保护 JSON、未加密 JSON 和 CSV</p>
							</div>
						</div>
					</div>

					<div class="space-y-1.5">
						<span class="text-xs font-semibold text-slate-400">文件格式</span>
						<select bind:value={importFormat} onchange={resetImportSelection} class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="json">Bitwarden JSON（密码保护或未加密）</option><option value="csv">Bitwarden CSV</option></select>
					</div>

					<div class="space-y-1.5">
						<span class="text-xs font-semibold text-slate-400">选择文件</span>
						<input
							type="file"
							accept={importFormat === "json" ? ".json,application/json" : ".csv,text/csv"}
							bind:files
							onchange={prepareImport}
							disabled={importing}
							class="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
						/>
					</div>

						{#if pendingImport}<div class="rounded-md border bg-muted p-3 text-xs"><p class="font-medium">导入预览</p><p>{pendingImport.folders.length} 个文件夹，{pendingImport.items.length} 个条目</p>{#if pendingImport.warnings.length}<p class="mt-1 text-amber-600">{pendingImport.warnings.length} 条格式警告</p>{/if}</div>{/if}
						{#if encryptedImport}<div class="space-y-1.5"><label for="import-password" class="text-xs font-semibold text-slate-400">加密导出密码</label><input id="import-password" type="password" autocomplete="off" bind:value={importPassword} class="h-9 w-full rounded-md border bg-background px-3 text-sm" placeholder="仅在浏览器内用于解密" /><p class="text-[10px] text-slate-400">密码和解密后的内容不会发送到服务器。</p></div>{/if}

					<Button
						class="w-full bg-primary font-semibold py-2"
						disabled={importing || (!pendingImport && !(encryptedImport && importPassword))}
						onclick={handleImport}
					>
						{#if importing}
							<div class="size-4 rounded-full border-2 border-white border-t-transparent animate-spin mr-2"></div>
							正在导入并加密数据...
						{:else}
							<Upload class="size-4 mr-2" />
							导入数据
						{/if}
					</Button>
				</div>
			</section>

			<!-- Export Panel -->
			<section class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/20 text-amber-500 flex items-center justify-center">
						<Download class="size-5" />
					</div>
					<div>
						<h3 class="font-bold text-slate-800 dark:text-slate-100">导出密码数据</h3>
						<p class="text-xs text-slate-400">备份您存储在保险库中的全部密码数据</p>
					</div>
				</div>

				<hr class="border-slate-100 dark:border-slate-850" />

				<div class="space-y-4">
					<div class="space-y-1.5"><span class="text-xs font-semibold text-slate-400">导出格式</span><select bind:value={exportFormat} class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="json">Bitwarden JSON（完整）</option><option value="csv">Bitwarden CSV（登录与笔记）</option></select></div>
					<div class="p-4 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 rounded-xl border border-amber-200 dark:border-amber-900/50 flex items-start gap-3">
						<ShieldAlert class="size-5 shrink-0 mt-0.5" />
						<div>
							<h4 class="font-bold text-xs">安全警告</h4>
							<p class="text-[10px] leading-relaxed mt-1">
								导出的备份文件包含明文存储的所有用户名、密码、笔记以及支付卡片！
								请切勿将此文件发送给他人，用完后请立即删除或存放于高度安全的地方。
							</p>
						</div>
					</div>

					<div class="h-6"></div>

					<Button
						variant="outline"
						class="w-full border-amber-200 dark:border-amber-900/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 font-semibold py-2"
						onclick={handleExport}
					>
						<Download class="size-4 mr-2" />
						导出数据
					</Button>
				</div>
			</section>
		</div>
	</main>
</div>
