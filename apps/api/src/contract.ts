/**
 * Browser-facing type-only boundary for the Hono RPC client.
 *
 * Keeping this as a dedicated export prevents consumers from treating the
 * Worker entrypoint as a browser runtime dependency. The declaration build is
 * incremental, so unchanged server implementation files are not re-emitted.
 */
export type { AppType } from "./index";
