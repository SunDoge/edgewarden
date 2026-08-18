import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"cloudflare:workers": path.resolve(
				import.meta.dirname,
				"src/test-support/cloudflare-workers.ts",
			),
		},
	},
	test: {
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.worker.test.ts"],
	},
});
