/** Respect explicit data saving and connections too slow for speculative code. */
export function allowsRoutePreload(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return (
    !connection?.saveData &&
    !/^(slow-)?2g$/.test(connection?.effectiveType ?? "")
  );
}

/** Warm a small set of common routes without competing with the first task.
 * Imports already in flight cannot be cancelled, but disposal stops the queue. */
export function warmRoutes(
  paths: readonly string[],
  preload: (path: string) => Promise<void>,
  canPreload: () => boolean,
): () => void {
  if (!allowsRoutePreload()) return () => undefined;

  let disposed = false;
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;

  function schedule() {
    if (disposed || index >= paths.length || !allowsRoutePreload()) return;
    // Leave the initial navigation, sync and any immediate user choice alone.
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed) return;
      if (document.visibilityState !== "visible" || !canPreload()) {
        schedule();
        return;
      }
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(() => {
          idle = undefined;
          void next();
        });
      } else void next();
    }, 3000);
  }

  async function next() {
    if (disposed || !allowsRoutePreload()) return;
    if (document.visibilityState !== "visible" || !canPreload()) {
      schedule();
      return;
    }
    try {
      await preload(paths[index++]);
    } catch {
      // Speculative loading must not surface an error or prevent navigation.
    }
    schedule();
  }

  schedule();
  return () => {
    disposed = true;
    clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}
