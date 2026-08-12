function toBufferSource(bytes: Uint8Array): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

// ── TOTP Decrypt & Calc ─────────────────────────────────────────────────────

function normalizeTotpSecret(secret: string): string {
	return secret.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/g, "");
}

function readOtpAuthParam(raw: string, name: string): string {
	const queryStart = raw.indexOf("?");
	if (queryStart < 0) return "";
	const fragmentStart = raw.indexOf("#", queryStart + 1);
	const query = raw.slice(
		queryStart + 1,
		fragmentStart > queryStart ? fragmentStart : undefined,
	);
	for (const part of query.split("&")) {
		const eq = part.indexOf("=");
		const key = eq >= 0 ? part.slice(0, eq) : part;
		if (key.trim().toLowerCase() !== name.toLowerCase()) continue;
		const value = eq >= 0 ? part.slice(eq + 1) : "";
		try {
			return decodeURIComponent(value.replace(/\+/g, " "));
		} catch {
			return value;
		}
	}
	return "";
}

function parseSteamSecret(raw: string): string {
	const match = raw.trim().match(/^steam:\/\/([^/?#]+)(?:[/?#].*)?$/i);
	if (!match?.[1]) return "";
	try {
		return normalizeTotpSecret(decodeURIComponent(match[1]));
	} catch {
		return normalizeTotpSecret(match[1]);
	}
}

type TotpHashAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

interface TotpConfig {
	secret: string;
	steam: boolean;
	algorithm: TotpHashAlgorithm;
	digits: number;
	period: number;
}

const DEFAULT_TOTP_CONFIG: Omit<TotpConfig, "secret" | "steam"> = {
	algorithm: "SHA-1",
	digits: 6,
	period: 30,
};

function parseTotpPositiveInt(
	value: string | null,
	fallback: number,
	min: number,
	max: number,
): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max)
		return fallback;
	return parsed;
}

function parseTotpHashAlgorithm(value: string | null): TotpHashAlgorithm {
	const normalized = (value || "")
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
	if (normalized === "SHA256") return "SHA-256";
	if (normalized === "SHA512") return "SHA-512";
	return "SHA-1";
}

function parseTotpConfig(raw: string): TotpConfig {
	if (!raw) return { secret: "", steam: false, ...DEFAULT_TOTP_CONFIG };
	const s = raw.trim();
	if (!s) return { secret: "", steam: false, ...DEFAULT_TOTP_CONFIG };
	if (/^steam:\/\//i.test(s)) {
		return {
			secret: parseSteamSecret(s),
			steam: true,
			algorithm: "SHA-1",
			digits: 5,
			period: 30,
		};
	}
	if (/^otpauth:\/\//i.test(s)) {
		try {
			const u = new URL(s);
			const otpType = u.hostname.toLowerCase();
			if (otpType !== "totp") {
				return { secret: "", steam: false, ...DEFAULT_TOTP_CONFIG };
			}
			const label = decodeURIComponent(
				(u.pathname || "").replace(/^\/+/, ""),
			).toLowerCase();
			const issuer = (u.searchParams.get("issuer") || "").trim().toLowerCase();
			const algorithm = (u.searchParams.get("algorithm") || "")
				.trim()
				.toLowerCase();
			const steam =
				issuer === "steam" ||
				label.startsWith("steam:") ||
				algorithm === "steam";
			return {
				secret: normalizeTotpSecret(u.searchParams.get("secret") || ""),
				steam,
				algorithm: steam
					? "SHA-1"
					: parseTotpHashAlgorithm(u.searchParams.get("algorithm")),
				digits: steam
					? 5
					: parseTotpPositiveInt(
							u.searchParams.get("digits"),
							DEFAULT_TOTP_CONFIG.digits,
							1,
							10,
						),
				period: parseTotpPositiveInt(
					u.searchParams.get("period"),
					DEFAULT_TOTP_CONFIG.period,
					1,
					3600,
				),
			};
		} catch {
			const issuer = readOtpAuthParam(s, "issuer").trim().toLowerCase();
			const algorithm = readOtpAuthParam(s, "algorithm").trim().toLowerCase();
			const steam = issuer === "steam" || algorithm === "steam";
			return {
				secret: normalizeTotpSecret(readOtpAuthParam(s, "secret")),
				steam,
				algorithm: steam ? "SHA-1" : parseTotpHashAlgorithm(algorithm),
				digits: steam
					? 5
					: parseTotpPositiveInt(
							readOtpAuthParam(s, "digits"),
							DEFAULT_TOTP_CONFIG.digits,
							1,
							10,
						),
				period: parseTotpPositiveInt(
					readOtpAuthParam(s, "period"),
					DEFAULT_TOTP_CONFIG.period,
					1,
					3600,
				),
			};
		}
	}
	return {
		secret: normalizeTotpSecret(s),
		steam: false,
		...DEFAULT_TOTP_CONFIG,
	};
}

export function extractTotpSecret(raw: string): string {
	return parseTotpConfig(raw).secret;
}

function base32ToBytes(input: string): Uint8Array {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (let i = 0; i < clean.length; i += 1) {
		const idx = alphabet.indexOf(clean.charAt(i));
		if (idx < 0) continue;
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

export async function calcTotpNow(
	rawSecret: string,
	nowMs: number = Date.now(),
): Promise<{ code: string; remain: number } | null> {
	const { secret, steam, algorithm, digits, period } =
		parseTotpConfig(rawSecret);
	if (!secret) return null;
	const keyBytes = base32ToBytes(secret);
	if (!keyBytes.length) return null;
	const epoch = Math.floor(nowMs / 1000);
	const counter = Math.floor(epoch / period);
	const remain = period - (epoch % period);

	const message = new Uint8Array(8);
	let c = counter;
	for (let i = 7; i >= 0; i -= 1) {
		message[i] = c & 0xff;
		c = Math.floor(c / 256);
	}
	const key = await crypto.subtle.importKey(
		"raw",
		toBufferSource(keyBytes),
		{ name: "HMAC", hash: algorithm },
		false,
		["sign"],
	);
	const hs = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, toBufferSource(message)),
	);
	const offset = hs[hs.length - 1] & 0x0f;
	const bin =
		((hs[offset] & 0x7f) << 24) |
		((hs[offset + 1] & 0xff) << 16) |
		((hs[offset + 2] & 0xff) << 8) |
		(hs[offset + 3] & 0xff);
	let code = (bin % 10 ** digits).toString().padStart(digits, "0");
	if (steam) {
		const chars = "23456789BCDFGHJKMNPQRTVWXY";
		let value = bin;
		code = "";
		for (let i = 0; i < 5; i += 1) {
			code += chars[value % chars.length];
			value = Math.floor(value / chars.length);
		}
	}
	return { code, remain };
}
