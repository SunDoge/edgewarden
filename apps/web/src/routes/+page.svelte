<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { isLoggedIn } from "$lib/services/api";
import { restoreWebSession } from "$lib/services/rpc";
import * as Empty from "$lib/components/ui/empty/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";

onMount(async () => {
	await restoreWebSession();
	if (isLoggedIn()) {
		goto("/vault");
	} else {
		goto("/login");
	}
});
</script>

<div class="flex min-h-screen items-center justify-center bg-muted/30">
	<Empty.Root><Empty.Media variant="icon"><Spinner /></Empty.Media><Empty.Header><Empty.Title>正在载入 Edgewarden</Empty.Title><Empty.Description>正在恢复本地会话。</Empty.Description></Empty.Header></Empty.Root>
</div>
