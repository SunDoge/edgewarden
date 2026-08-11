import { factory } from "../http/factory";

const MAX_ICON_BYTES = 256 * 1024;
const SAFE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"]);

function fallbackIcon(): Response {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#334155"/><path d="M19 29h26v22H19z" fill="#fff"/><path d="M24 29v-7a8 8 0 0 1 16 0v7" fill="none" stroke="#fff" stroke-width="5"/></svg>';
	return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}

function normalizePublicHost(raw: string): string | null {
	try {
		const host = new URL(`https://${decodeURIComponent(raw)}`).hostname.toLowerCase().replace(/\.$/, "");
		if (!host || host === "localhost" || host.endsWith(".local") || host.includes(":")) return null;
		if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
		if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return null;
		return host;
	} catch {
		return null;
	}
}

export const getWebsiteIcon = factory.createHandlers(async (c) => {
	const host = normalizePublicHost(c.req.param("host") ?? "");
	if (!host) return fallbackIcon();
	try {
		const upstream = await fetch(`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`, {
			headers: { Accept: "image/png,image/webp,image/*;q=0.8" },
			signal: AbortSignal.timeout(5_000),
		});
		const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
		const declaredSize = Number(upstream.headers.get("content-length") ?? 0);
		if (!upstream.ok || !SAFE_CONTENT_TYPES.has(contentType) || declaredSize > MAX_ICON_BYTES) return fallbackIcon();
		const bytes = await upstream.arrayBuffer();
		if (bytes.byteLength > MAX_ICON_BYTES) return fallbackIcon();
		return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
	} catch {
		return fallbackIcon();
	}
});
