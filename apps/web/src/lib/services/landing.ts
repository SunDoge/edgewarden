/** Build-time override controls presentation only, never Demo write permissions. */
export async function loadLandingSettings(
  signal: AbortSignal,
  override: string | undefined = import.meta.env.VITE_LANDING_PAGE,
): Promise<{ enabled: boolean; demo: boolean }> {
  if (override === "false") return { enabled: false, demo: false };
  let demo = false;
  try {
    const response = await fetch("/api/demo", {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (response.ok) {
      const status = await response.json();
      demo = status?.enabled === true && status?.readOnly === true;
    }
  } catch {
    // Discovery failure must not advertise an ordinary vault as a public demo.
  }
  return { enabled: override === "true" || demo, demo };
}
