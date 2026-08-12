<script lang="ts">
import "./layout.css";
import { onMount } from "svelte";
import {
	applyThemePreference,
	clientPreferencesStorageKey,
	loadClientPreferences,
} from "$lib/services/client-preferences";
import {
	NetworkStatusMonitor,
	type NetworkStatus,
} from "$lib/services/network-status";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Wifi, WifiOff } from "@lucide/svelte";
import { EDGEWARDEN_VERSION } from "@edgewarden/shared";

let { children } = $props();
let networkStatus = $state<NetworkStatus>("checking");

onMount(() => {
	const media = matchMedia("(prefers-color-scheme: dark)");
	const apply = () => applyThemePreference(loadClientPreferences().theme);
	const onStorage = (event: StorageEvent) => {
		if (event.key === clientPreferencesStorageKey()) apply();
	};
	apply();
	media.addEventListener("change", apply);
	window.addEventListener("storage", onStorage);
	return () => {
		media.removeEventListener("change", apply);
		window.removeEventListener("storage", onStorage);
	};
});

onMount(() => {
	const monitor = new NetworkStatusMonitor({
		probe: async () => {
			const response = await fetch("/api/version", {
				cache: "no-store",
				signal: AbortSignal.timeout(5_000),
			});
			if (!response.ok) throw new Error("Service unavailable");
		},
		onStatus: (status) => {
			networkStatus = status;
		},
	});
	const check = () => void monitor.check();
	const offline = () => void monitor.check(false);
	const visible = () => {
		if (document.visibilityState === "visible") check();
	};
	monitor.start();
	window.addEventListener("online", check);
	window.addEventListener("offline", offline);
	window.addEventListener("focus", check);
	document.addEventListener("visibilitychange", visible);
	return () => {
		monitor.stop();
		window.removeEventListener("online", check);
		window.removeEventListener("offline", offline);
		window.removeEventListener("focus", check);
		document.removeEventListener("visibilitychange", visible);
	};
});
</script>

<svelte:head>
	<link rel="icon" href="/edgewarden-icon.svg" type="image/svg+xml" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#0f172a" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>
{@render children()}
<div class="fixed bottom-3 right-3 z-50" aria-live="polite">
	<Badge variant={networkStatus === "offline" ? "destructive" : "outline"}>
		{#if networkStatus === "offline"}<WifiOff class="size-3" />离线{:else}<Wifi class="size-3" />{networkStatus === "checking" ? "检查连接" : "在线"}{/if}
	</Badge>
	<span class="sr-only">Edgewarden {EDGEWARDEN_VERSION}</span>
</div>
