<script lang="ts">
import { onMount } from "svelte";
import { fade } from "svelte/transition";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import {
	createRealtimeTicketApi,
	fetchRevisionDateApi,
	isLoggedIn,
} from "$lib/services/api";
import { syncVaultData, vault } from "$lib/stores/vault.svelte";
import { lock, logout } from "$lib/stores/vault.svelte";
import { VaultRevisionWatcher } from "$lib/services/vault-revision-watcher";
import { VaultRealtimeClient } from "$lib/services/vault-realtime";
import {
	CLIENT_PREFERENCES_CHANGED_EVENT,
	clientPreferencesStorageKey,
	loadClientPreferences,
} from "$lib/services/client-preferences";
import { SessionTimeout } from "$lib/services/session-timeout";
import { restoreWebSession } from "$lib/services/rpc";

let { children } = $props();
let ready = $state(false);
let preferencesVersion = $state(0);

onMount(() => {
	let disposed = false;
	const preferencesChanged = () => {
		preferencesVersion += 1;
	};
	const storageChanged = (event: StorageEvent) => {
		if (event.key === clientPreferencesStorageKey()) preferencesChanged();
	};
	window.addEventListener(CLIENT_PREFERENCES_CHANGED_EVENT, preferencesChanged);
	window.addEventListener("storage", storageChanged);
	void (async () => {
		await restoreWebSession();
		if (!isLoggedIn()) {
			await goto("/login");
			return;
		}
		if (page.url.pathname !== "/vault/unlock" && !vault.isUnlocked) {
			await goto("/vault/unlock");
			if (!disposed) ready = true;
			return;
		}
		if (disposed) return;
		ready = true;
	})();
	return () => {
		disposed = true;
		window.removeEventListener(
			CLIENT_PREFERENCES_CHANGED_EVENT,
			preferencesChanged,
		);
		window.removeEventListener("storage", storageChanged);
	};
});

$effect(() => {
	if (!ready || !vault.isUnlocked) return;
	const watcher = new VaultRevisionWatcher({
		readRevision: fetchRevisionDateApi,
		onRevision: async () => {
			if (!vault.isSyncing && vault.isUnlocked) await syncVaultData();
		},
	});
	const realtime = new VaultRealtimeClient({
		getTicket: async () => (await createRealtimeTicketApi()).token,
		onRevision: async () => {
			if (!vault.isSyncing && vault.isUnlocked) await syncVaultData();
		},
	});
	const refreshWhenVisible = () => {
		if (document.visibilityState === "visible") void watcher.check();
	};
	const refreshWhenOnline = () => void watcher.check();
	watcher.start();
	realtime.start();
	document.addEventListener("visibilitychange", refreshWhenVisible);
	window.addEventListener("online", refreshWhenOnline);
	return () => {
		watcher.stop();
		realtime.stop();
		document.removeEventListener("visibilitychange", refreshWhenVisible);
		window.removeEventListener("online", refreshWhenOnline);
	};
});

$effect(() => {
	if (!ready || !vault.isUnlocked) return;
	preferencesVersion;
	const preferences = loadClientPreferences();
	const timeout = new SessionTimeout({
		timeoutMs: preferences.lockTimeoutMinutes * 60_000,
		onTimeout: async () => {
			if (preferences.sessionTimeoutAction === "logout") {
				await logout();
				await goto("/login?reason=timeout");
			} else {
				lock();
				await goto("/vault/unlock?reason=timeout");
			}
		},
	});
	const activity = () => timeout.reset();
	const visible = () => {
		if (document.visibilityState === "visible") activity();
	};
	for (const event of ["pointerdown", "keydown", "touchstart"] as const)
		window.addEventListener(event, activity, { passive: true });
	document.addEventListener("visibilitychange", visible);
	timeout.reset();
	return () => {
		timeout.stop();
		for (const event of ["pointerdown", "keydown", "touchstart"] as const)
			window.removeEventListener(event, activity);
		document.removeEventListener("visibilitychange", visible);
	};
});
</script>

{#if ready}
	<div class="min-h-screen" transition:fade={{ duration: 140 }}>
		{@render children()}
	</div>
{/if}
