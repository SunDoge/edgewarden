const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileVerificationResponse {
	success?: boolean;
	action?: string;
	["error-codes"]?: string[];
}

export function turnstileEnabled(env: CloudflareBindings): boolean {
	return Boolean(String((env as any).TURNSTILE_SECRET_KEY || "").trim());
}

export function turnstileSiteKey(env: CloudflareBindings): string | null {
	const key = String((env as any).TURNSTILE_SITE_KEY || "").trim();
	return key || null;
}

export async function verifyTurnstileToken(
	env: CloudflareBindings,
	token: string,
	remoteIp?: string,
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	const secret = String((env as any).TURNSTILE_SECRET_KEY || "").trim();
	if (!secret) return true;
	if (!token || token.length > 2048) return false;
	const form = new FormData();
	form.set("secret", secret);
	form.set("response", token);
	form.set("idempotency_key", crypto.randomUUID());
	if (remoteIp) form.set("remoteip", remoteIp);
	try {
		const response = await fetchImpl(SITEVERIFY_URL, {
			method: "POST",
			body: form,
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok) return false;
		const result = await response.json<TurnstileVerificationResponse>();
		return result.success === true && result.action === "login";
	} catch {
		return false;
	}
}
