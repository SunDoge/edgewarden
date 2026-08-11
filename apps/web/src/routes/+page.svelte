<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { isLoggedIn } from "$lib/services/api";

onMount(() => {
	if (isLoggedIn()) {
		goto("/vault");
	} else {
		goto("/login");
	}
});
</script>

<div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
	<div class="flex flex-col items-center gap-3">
		<div class="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
		<p class="text-slate-500 font-medium text-sm">正在载入 Edgewarden...</p>
	</div>
</div>
