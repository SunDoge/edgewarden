<script lang="ts">
import { onMount } from "svelte";

type TurnstileApi = {
	render(container: HTMLElement, options: Record<string, unknown>): string;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
};

let {
	siteKey,
	action = "login",
	onToken,
	onError,
}: {
	siteKey: string;
	action?: "login" | "register";
	onToken: (token: string) => void;
	onError: () => void;
} = $props();
let container: HTMLDivElement;
let widgetId: string | null = null;

function api(): TurnstileApi | null {
	return (
		(window as typeof window & { turnstile?: TurnstileApi }).turnstile ?? null
	);
}

export function reset(): void {
	onToken("");
	if (widgetId) api()?.reset(widgetId);
}

onMount(() => {
	let disposed = false;
	const render = () => {
		if (disposed || widgetId || !api()) return;
		widgetId = api()!.render(container, {
			sitekey: siteKey,
			action,
			theme: "auto",
			callback: (token: string) => onToken(token),
			"expired-callback": () => reset(),
			"error-callback": () => {
				reset();
				onError();
			},
		});
	};
	const existing = document.querySelector<HTMLScriptElement>(
		"script[data-edgewarden-turnstile]",
	);
	const script = existing ?? document.createElement("script");
	if (!existing) {
		script.src =
			"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
		script.async = true;
		script.defer = true;
		script.dataset.edgewardenTurnstile = "true";
		document.head.append(script);
	}
	if (api()) render();
	else script.addEventListener("load", render, { once: true });
	return () => {
		disposed = true;
		script.removeEventListener("load", render);
		if (widgetId) api()?.remove(widgetId);
		widgetId = null;
	};
});
</script>

<div bind:this={container} class="flex min-h-16 justify-center" aria-label="人机验证"></div>
