import type { CipherResponse } from "@edgewarden/shared";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";

export interface PasswordHealthItem {
	cipherId: string;
	exposedCount: number | null;
	reusedCount: number;
	weak: boolean;
}

export interface PasswordHealthReport {
	eligibleCount: number;
	exposedCount: number;
	reusedCount: number;
	weakCount: number;
	unavailableCount: number;
	items: PasswordHealthItem[];
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function sha1Password(password: string): Promise<string> {
	return toHex(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password))));
}

export function isWeakPassword(password: string, username = ""): boolean {
	const normalized = password.toLowerCase();
	const accountName = username.split("@")[0]?.trim().toLowerCase() ?? "";
	if (password.length < 10 || new Set(["password", "password1", "123456", "12345678", "qwerty", "abc123", "letmein", "admin"]).has(normalized)) return true;
	if (/^(.)\1+$/.test(password)) return true;
	if (accountName.length >= 3 && normalized.includes(accountName)) return true;
	const classes = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
	return password.length < 14 && classes < 3;
}

export function parsePwnedRange(text: string, suffix: string): number {
	for (const line of text.split(/\r?\n/)) {
		const [candidate, rawCount] = line.split(":", 2);
		if (candidate?.toUpperCase() !== suffix) continue;
		const count = Number.parseInt(rawCount ?? "", 10);
		return Number.isSafeInteger(count) && count > 0 ? count : 0;
	}
	return 0;
}

export async function checkPasswordHash(hash: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<number> {
	if (!/^[A-F0-9]{40}$/.test(hash)) throw new Error("密码摘要无效");
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 12_000);
	const abort = () => controller.abort();
	signal?.addEventListener("abort", abort, { once: true });
	try {
		const response = await fetchImpl(`${RANGE_URL}${hash.slice(0, 5)}`, {
			headers: { "Add-Padding": "true" }, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
		});
		if (!response.ok) throw new Error(`泄露密码查询失败 (${response.status})`);
		return parsePwnedRange(await response.text(), hash.slice(5));
	} catch (error) {
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
		if ((error as { name?: string })?.name === "AbortError") throw new Error("泄露密码查询超时");
		throw error;
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}

export async function inspectPasswordHealth(ciphers: CipherResponse[], fetchImpl: typeof fetch = fetch, signal?: AbortSignal, onProgress?: (checked: number, total: number) => void): Promise<PasswordHealthReport> {
	const candidates = await Promise.all(ciphers.filter((cipher) => cipher.type === 1 && !cipher.deletedDate && !(cipher as any).hidePasswords && cipher.login?.password).map(async (cipher) => ({
		cipherId: cipher.id,
		password: String(cipher.login?.password ?? ""),
		username: String(cipher.login?.username ?? ""),
		hash: await sha1Password(String(cipher.login?.password ?? "")),
	})));
	const groups = Map.groupBy(candidates, (candidate) => candidate.hash);
	const exposure = new Map<string, number | null>();
	const hashes = [...groups.keys()];
	let next = 0;
	let checked = 0;
	await Promise.all(Array.from({ length: Math.min(5, hashes.length) }, async () => {
		while (next < hashes.length) {
			const hash = hashes[next++];
			try { exposure.set(hash, await checkPasswordHash(hash, fetchImpl, signal)); }
			catch (error) { if (signal?.aborted) throw error; exposure.set(hash, null); }
			checked += groups.get(hash)?.length ?? 0;
			onProgress?.(Math.min(checked, candidates.length), candidates.length);
		}
	}));
	const all = candidates.map((candidate) => ({
		cipherId: candidate.cipherId,
		exposedCount: exposure.get(candidate.hash) ?? null,
		reusedCount: groups.get(candidate.hash)?.length ?? 1,
		weak: isWeakPassword(candidate.password, candidate.username),
	}));
	return {
		eligibleCount: all.length,
		exposedCount: all.filter((item) => (item.exposedCount ?? 0) > 0).length,
		reusedCount: all.filter((item) => item.reusedCount > 1).length,
		weakCount: all.filter((item) => item.weak).length,
		unavailableCount: all.filter((item) => item.exposedCount === null).length,
		items: all.filter((item) => item.exposedCount === null || item.exposedCount > 0 || item.reusedCount > 1 || item.weak).sort((a, b) => Number(b.exposedCount ?? 0) - Number(a.exposedCount ?? 0) || b.reusedCount - a.reusedCount || Number(b.weak) - Number(a.weak)),
	};
}
