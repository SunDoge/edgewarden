<script lang="ts">
import * as Sheet from "$lib/components/ui/sheet/index.js";
import VaultAppSidebar from "./VaultAppSidebar.svelte";

let { mobileOpen = $bindable(false) }: { mobileOpen: boolean } = $props();
</script>

<Sheet.Root bind:open={mobileOpen}>
	<Sheet.Content side="left" class="w-72 gap-0 p-0 md:hidden" showCloseButton={false}>
		<Sheet.Header class="sr-only">
			<Sheet.Title>应用导航</Sheet.Title>
			<Sheet.Description>打开保险库、工具和管理页面。</Sheet.Description>
		</Sheet.Header>
		<VaultAppSidebar onNavigate={() => (mobileOpen = false)} />
	</Sheet.Content>
</Sheet.Root>

<div class="hidden md:flex">
	<VaultAppSidebar />
</div>
