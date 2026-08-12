import type { WorkerBindings } from "../worker-bindings";

const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileVerificationResponse {
	success?: boolean;
	action?: string;
}

export function turnstileEnabled(env: WorkerBindings): boolean {
	return Boolean(String(env.TURNSTILE_SECRET_KEY || "").trim());
}

export function turnstileSiteKey(env: WorkerBindings): string | null {
	const key = String(env.TURNSTILE_SITE_KEY || "").trim();
	return key || null;
}

export async function verifyTurnstileToken(
	env: WorkerBindings,
	token: string,
	expectedAction: "login" | "register",
	remoteIp?: string,
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	const secret = String(env.TURNSTILE_SECRET_KEY || "").trim();
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
		return result.success === true && result.action === expectedAction;
	} catch {
		return false;
	}
}
