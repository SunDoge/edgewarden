# Testing guide

Edgewarden uses one test runner, Vitest, with small helpers for each runtime. Choose the lowest layer that still exercises the behavior being changed.

## Commands

```sh
pnpm test                         # API and Web suites
pnpm --filter @edgewarden/api test
pnpm --filter @edgewarden/web test
pnpm test:compat:bw              # official Bitwarden CLI smoke test
pnpm test:integration:cloudflare # deployed Worker smoke test
```

Run `pnpm check` as well when changing schemas, generated RPC types, Svelte components, bindings, or migrations.

## API tests

Use `createApiTestHarness()` from `apps/api/src/test-support/api-harness.ts`. It applies the real migrations to an isolated Miniflare D1 database, supplies test bindings, invokes the full Hono middleware stack through `app.request()`, and waits for `waitUntil()` work before returning.

```ts
const harness = await createApiTestHarness(TEST_SECRETS);

const created = await harness.json("/api/example", { name: "encrypted" });
const body = await expectJson<{ id: string }>(created, 201);

const client = harness.authenticated(accessToken);
const sync = await client.request("/api/sync");
expect(sync.status).toBe(200);

await harness.dispose();
```

- Use `json()` instead of repeating the content type and `JSON.stringify()`.
- Use `authenticated()` instead of manually rebuilding bearer headers.
- Use `expectJson<T>()` when the response body is relevant. Status failures include the returned body.
- Query `harness.database` when an externally visible response is insufficient to prove an atomicity or persistence invariant.
- Use a deliberately failing D1 trigger for rollback tests; do not mock the query builder.

Hono does not require its own test runner. Its `app.request()` API provides an in-memory HTTP boundary and works with Vitest. `hono/testing` also provides `testClient()` for small type-safe route units, but the main Edgewarden suite intentionally exercises the assembled middleware and Worker bindings.

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

The API harness uses real Miniflare D1 and KV implementations while keeping R2, rate limiting, and realtime bindings deterministic. Add a separate `@cloudflare/vitest-pool-workers` suite only for behavior that depends on workerd runtime semantics and cannot be represented by this harness; moving the entire database-heavy suite would make fixtures harder to control without improving every test.

Use the deployed Cloudflare smoke test for binding and deployment integration. Use the Bitwarden CLI smoke test for protocol compatibility. Neither replaces unit and integration tests because they require external state and are slower to diagnose.

## What to add with a change

- Pure transformation or crypto rule: Web/API unit test.
- Route, middleware, authorization, D1 transaction, or `waitUntil`: API harness test.
- Svelte interaction or responsive state: Testing Library component test.
- Migration: migration verifier plus an API persistence scenario.
- Binding/runtime behavior: Cloudflare integration smoke test or a focused workerd test.
- Bitwarden protocol response: API test plus CLI smoke coverage when feasible.
