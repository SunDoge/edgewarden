import * as v from "valibot";

const DemoCredentialsSchema = v.object({
  enabled: v.literal(true),
  readOnly: v.literal(true),
  email: v.pipe(v.string(), v.email()),
  password: v.pipe(v.string(), v.minLength(1)),
});

/** Only the same-origin server can opt into public Demo autofill.
 * Check eligibility after the request: slow responses must not overwrite input.
 * No storage, login submission, or production credential fallback is involved. */
export async function prefillDemoLogin(
  canFill: () => boolean,
  fill: (credentials: { email: string; password: string }) => void,
  signal: AbortSignal,
): Promise<void> {
  try {
    const response = await fetch("/api/demo", {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) return;
    const parsed = v.safeParse(DemoCredentialsSchema, await response.json());
    if (!parsed.success || signal.aborted || !canFill()) return;
    fill({ email: parsed.output.email, password: parsed.output.password });
  } catch {
    // Demo discovery is optional; manual login must still work when it fails.
  }
}
