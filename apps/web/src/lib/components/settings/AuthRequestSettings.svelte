<script lang="ts">
import { onMount } from "svelte";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import {
  encryptVaultKeyForAuthRequest,
  listPendingAuthRequestsApi,
  respondToAuthRequestApi,
  type AuthRequest,
} from "$lib/services/auth-requests";
import { vault } from "$lib/stores/vault.svelte";
import { RefreshCw, ShieldCheck } from "@lucide/svelte";
import { match } from "ts-pattern";

let {
  email,
  onMessage,
  onError,
}: {
  email: string;
  onMessage: (message: string) => void;
  onError: (error: unknown) => void;
} = $props();

let requests = $state<AuthRequest[]>([]);
let busy = $state("");

function deviceTypeLabel(type: number): string {
  return match(type)
    .with(0, () => "浏览器")
    .with(1, () => "Android")
    .with(2, () => "iOS")
    .with(3, () => "桌面客户端")
    .otherwise(() => `设备类型 ${type}`);
}

async function refresh() {
  busy = "refresh";
  try {
    requests = await listPendingAuthRequestsApi(email);
  } catch (error) {
    onError(error);
  } finally {
    busy = "";
  }
}

async function respond(request: AuthRequest, approved: boolean) {
  busy = request.id;
  try {
    let key: string | undefined;
    if (approved) {
      if (!vault.symEncKey || !vault.symMacKey) {
        throw new Error("保险库密钥不可用，请重新解锁");
      }
      key = await encryptVaultKeyForAuthRequest(
        request.publicKey,
        vault.symEncKey,
        vault.symMacKey,
      );
    }
    await respondToAuthRequestApi(request.id, approved, key);
    requests = requests.filter((item) => item.id !== request.id);
    onMessage(approved ? "已批准设备登录" : "已拒绝设备登录");
  } catch (error) {
    onError(error);
  } finally {
    busy = "";
  }
}

onMount(refresh);
</script>

<Card.Root>
	<Card.Header class="flex-row items-start justify-between">
		<div>
			<Card.Title>待审批设备登录</Card.Title>
			<Card.Description>批准前请在请求设备上核对公钥指纹和设备信息。</Card.Description>
		</div>
		<Button variant="outline" size="sm" onclick={refresh} disabled={busy === "refresh"}>
			<RefreshCw class={busy === "refresh" ? "animate-spin" : ""} />刷新
		</Button>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#each requests as request (request.id)}
			<div class="flex flex-col gap-3 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
				<div class="min-w-0">
					<div class="font-medium">{deviceTypeLabel(request.requestDeviceType)}</div>
					<div class="truncate text-xs text-muted-foreground">{request.requestDeviceIdentifier}</div>
					<div class="text-xs text-muted-foreground">{new Date(request.creationDate).toLocaleString()}{request.requestIpAddress ? ` · ${request.requestIpAddress}` : ""}</div>
					<code class="mt-2 block break-all text-xs">{request.fingerprint || "指纹不可用"}</code>
				</div>
				<div class="flex shrink-0 gap-2">
					<Button size="sm" onclick={() => respond(request, true)} disabled={!!busy}><ShieldCheck />批准</Button>
					<Button size="sm" variant="destructive" onclick={() => respond(request, false)} disabled={!!busy}>拒绝</Button>
				</div>
			</div>
		{:else}
			<p class="py-4 text-sm text-muted-foreground">没有待审批的设备登录。</p>
		{/each}
	</Card.Content>
</Card.Root>
