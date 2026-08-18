<script lang="ts">
let { remain, period }: { remain: number; period: number } = $props();

const radius = 18;
const circumference = 2 * Math.PI * radius;
const progress = $derived(Math.min(1, Math.max(0, remain / period)));
</script>

<div class="relative flex size-11 shrink-0 items-center justify-center" role="timer" aria-label={`${remain} 秒后刷新`}>
	<svg class="size-11 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
		<circle class="stroke-muted" cx="22" cy="22" r={radius} fill="none" stroke-width="4" />
		<circle
			class="stroke-primary transition-[stroke-dashoffset] duration-300"
			cx="22"
			cy="22"
			r={radius}
			fill="none"
			stroke-width="4"
			stroke-linecap="round"
			stroke-dasharray={circumference}
			stroke-dashoffset={circumference * (1 - progress)}
		/>
	</svg>
	<span class="absolute text-xs font-medium tabular-nums">{remain}</span>
</div>
