<script lang="ts">
import { goto } from "$app/navigation";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { Home } from "@lucide/svelte";
</script>

<svelte:head><title>页面不存在 · Edgewarden</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
	<Card.Root class="w-full max-w-lg text-center"><Card.Header><div class="text-6xl font-bold tracking-tight">404</div><Card.Title>页面不存在</Card.Title><Card.Description>这个地址不存在，或页面已经被移动。</Card.Description></Card.Header><Card.Footer class="justify-center"><Button onclick={() => goto("/")}><Home />返回首页</Button></Card.Footer></Card.Root>
</main>
