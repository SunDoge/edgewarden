/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { defineConfig } from "vitest/config";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide",
      emitTsDeclarations: true,
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
    }),
    sveltekit({
      serviceWorker: {
        // A cache-first service worker and Vite's mutable module graph cannot
        // safely control the same origin during development.
        register: command !== "serve",
      },
      csp: {
        mode: "hash",
        directives: {
          "default-src": ["self"],
          "base-uri": ["none"],
          "connect-src": [
            "self",
            "wss:",
            "https://challenges.cloudflare.com",
            "https://api.pwnedpasswords.com",
          ],
          "font-src": ["self"],
          "form-action": ["self"],
          "frame-ancestors": ["none"],
          "frame-src": ["https://challenges.cloudflare.com"],
          "img-src": ["self", "data:", "blob:"],
          "manifest-src": ["self"],
          "object-src": ["none"],
          "script-src": ["self", "https://challenges.cloudflare.com"],
          "script-src-attr": ["none"],
          "style-src": ["self", "unsafe-inline"],
          "worker-src": ["self", "blob:"],
        },
      },
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
      adapter: adapter({
        fallback: "index.html",
      }),
    }),
    svelteTesting(),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/identity": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/icons": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
}));
