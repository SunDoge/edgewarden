# Testing guide

Edgewarden uses one test runner, Vitest, with small helpers for each runtime. Choose the lowest layer that still exercises the behavior being changed.

## Commands

```sh
pnpm test                         # API and Web suites
pnpm --filter @edgewarden/api test
pnpm --filter @edgewarden/web test
pnpm test:compat:bw:local        # isolated local Worker + disposable account
pnpm test:compat:bw              # official Bitwarden CLI smoke test
pnpm test:integration:cloudflare # deployed Worker smoke test
```

Run `pnpm check` as well when changing schemas, generated RPC types, Svelte components, bindings, or migrations.

## API tests

Use `createApiTestHarness()` from `apps/api/src/test-support/api-harness.ts`. It applies the real migrations to an isolated Miniflare D1 database, supplies test bindings, invokes the full Hono middleware stack through `app.request()`, and waits for `waitUntil()` work before returning.

```ts
const harness = await createApiTestHarness(TEST_SECRETS);

try {
  const client = harness.authenticated(accessToken).rpc;
  const created = await client.api.folders.$post({
    json: { name: "encrypted-folder" },
  });
  expect(created.status).toBe(200);
  const folder = await expectJson<{ id: string }>(created);
  expect(folder.id).toBeTruthy();

  const sync = await client.api.sync.$get({
    query: { excludeDomains: "true" },
  });
  expect(sync.status).toBe(200);
} finally {
  await harness.dispose();
}
```

- Use `harness.rpc` for public routes and `harness.authenticated(token).rpc` for authenticated routes. Hono RPC checks route names, parameters, and validated request bodies; use inferred response types where available.
- Keep `request()` and `json()` for malformed input, unknown fields, legacy client payloads, and other wire-protocol checks. These tests must remain independent of our inferred client contract.
- Some handlers return native `Response` values or opaque encrypted JSON, which limits response inference. Use `expectJson<T>()` where a response shape must be stated explicitly; it includes the returned body on status failures.
- Query `harness.database` when an externally visible response is insufficient to prove an atomicity or persistence invariant.
- Use a deliberately failing D1 trigger for rollback tests; do not mock the query builder.

RPC calls use `hc<AppType>()` with a custom fetch that delegates to the same harness request function. Both request styles exercise the assembled middleware and real test bindings, and await background work. They do not start an HTTP server. Hono's `testClient()` is also suitable for small route tests, but does not perform the harness's background-task draining on its own.

## Web logic tests

Keep pure cryptography, parsing, stores, filters, and import/export logic in ordinary `*.test.ts` files. These run in the default Node environment and should not create a DOM.

Dexie tests use `fake-indexeddb`, so cache behavior can be tested without a browser or persistent local state.

## Svelte component tests

Add `// @vitest-environment jsdom` at the top of component test files and use `renderComponent()` from `apps/web/src/test/component.ts`.

```ts
// @vitest-environment jsdom
const { user } = renderComponent(MyForm, { onsave });

await user.type(screen.getByRole("textbox", { name: "名称" }), "示例");
await user.click(screen.getByRole("button", { name: "保存" }));
expect(onsave).toHaveBeenCalledOnce();
```

Prefer accessible role and label queries over CSS selectors. Test behavior visible to a user: disabled states, keyboard interaction, permissions, validation, dialogs, and callbacks. The Svelte Testing Library Vite plugin selects the browser build and cleans up mounted components automatically.

## Runtime and compatibility tests

The API harness uses real Miniflare D1 and KV implementations while keeping R2, rate limiting, and realtime bindings deterministic. `platform.worker.test.ts` runs separately through `@cloudflare/vitest-pool-workers` and verifies the generated configuration with real workerd D1, R2, and Durable Object bindings. Add focused `*.worker.test.ts` cases for behavior that depends on workerd runtime semantics; keep database-heavy business scenarios in the controllable API harness.

Use the deployed Cloudflare smoke test for binding and deployment integration. Use the Bitwarden CLI smoke test for protocol compatibility. Neither replaces unit and integration tests because they require external state and are slower to diagnose.

`test:compat:bw:local` creates a temporary Wrangler persistence directory, applies every migration, generates independent temporary secrets and configuration, starts an HTTPS development Worker using a temporary certificate trusted explicitly by Node and the CLI, registers a disposable account with its temporary `BOOTSTRAP_SECRET`, runs the same extended official CLI compatibility suite, and removes the temporary state. It never modifies the normal `.wrangler/state` database. The suite exercises all personal item types, lifecycle transitions, two-way sync, attachments, Sends, and lock/unlock behavior.

## What to add with a change

- Pure transformation or crypto rule: Web/API unit test.
- Route, middleware, authorization, D1 transaction, or `waitUntil`: API harness test.
- Svelte interaction or responsive state: Testing Library component test.
- Migration: migration verifier plus an API persistence scenario.
- Binding/runtime behavior: Cloudflare integration smoke test or a focused workerd test.
- Bitwarden protocol response: API test plus CLI smoke coverage when feasible.

The `Bitwarden CLI compatibility` CI job installs the pinned official CLI, builds the Web Vault, and runs this isolated suite. Local `.dev.vars` and Cloudflare credentials are not required.

The local CLI suite requires OpenSSL and Node.js 26. It keeps TLS certificate verification enabled. For the deployed integration smoke test against a private CA, launch Node with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`; disabling TLS verification is not supported.
