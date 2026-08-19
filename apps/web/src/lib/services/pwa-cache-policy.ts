const SENSITIVE_PREFIXES = ["/api/", "/identity/", "/webauthn"] as const;

export function isSensitiveCachePath(pathname: string): boolean {
  return SENSITIVE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function mayCacheRequest(
  method: string,
  requestUrl: string,
  origin: string,
): boolean {
  const url = new URL(requestUrl, origin);
  return (
    method === "GET" &&
    url.origin === origin &&
    !isSensitiveCachePath(url.pathname)
  );
}
