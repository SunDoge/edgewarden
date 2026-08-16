import * as OTPAuth from "otpauth";

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

function normalizeTotpSecret(secret: string): string {
	return secret.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/g, "");
}

interface TotpConfig {
	secret: string;
	steam: boolean;
	algorithm: string;
	digits: number;
	period: number;
}

const DEFAULT_CONFIG: Omit<TotpConfig, "secret" | "steam"> = {
	algorithm: "SHA1",
	digits: 6,
	period: 30,
};

function steamConfig(secret: string): TotpConfig {
	return {
		secret: normalizeTotpSecret(secret),
		steam: true,
		algorithm: "SHA1",
		digits: 5,
		period: 30,
	};
}

function parseSteamUri(raw: string): TotpConfig {
	const value = raw.trim().slice("steam://".length).split(/[/?#]/, 1)[0] ?? "";
	try {
		return steamConfig(decodeURIComponent(value));
	} catch {
		return steamConfig(value);
	}
}

function parseTotpConfig(raw: string): TotpConfig {
	const value = raw.trim();
	if (!value) return { secret: "", steam: false, ...DEFAULT_CONFIG };
	if (/^steam:\/\//i.test(value)) return parseSteamUri(value);

	if (/^otpauth:\/\//i.test(value)) {
		try {
			const url = new URL(value);
			const issuer = (url.searchParams.get("issuer") || "").toLowerCase();
			const label = decodeURIComponent(
				url.pathname.replace(/^\/+/, ""),
			).toLowerCase();
			const algorithm = (url.searchParams.get("algorithm") || "").toLowerCase();
			if (
				issuer === "steam" ||
				label.startsWith("steam:") ||
				algorithm === "steam"
			) {
				return steamConfig(url.searchParams.get("secret") || "");
			}

			const otp = OTPAuth.URI.parse(value);
			if (!(otp instanceof OTPAuth.TOTP))
				return { secret: "", steam: false, ...DEFAULT_CONFIG };
			return {
				secret: otp.secret.base32,
				steam: false,
				algorithm: otp.algorithm,
				digits: otp.digits,
				period: otp.period,
			};
		} catch {
			return { secret: "", steam: false, ...DEFAULT_CONFIG };
		}
	}

	return {
		secret: normalizeTotpSecret(value),
		steam: false,
		...DEFAULT_CONFIG,
	};
}

export function extractTotpSecret(raw: string): string {
	return parseTotpConfig(raw).secret;
}

async function generateSteamCode(
	secret: string,
	counter: number,
): Promise<string | null> {
	let key: OTPAuth.Secret;
	try {
		key = OTPAuth.Secret.fromBase32(secret);
	} catch {
		return null;
	}
	if (!key.bytes.length) return null;

	const message = new Uint8Array(8);
	let value = counter;
	for (let index = 7; index >= 0; index -= 1) {
		message[index] = value & 0xff;
		value = Math.floor(value / 256);
	}
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		toBufferSource(key.bytes),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const digest = new Uint8Array(
		await crypto.subtle.sign("HMAC", cryptoKey, toBufferSource(message)),
	);
	const offset = digest[digest.length - 1] & 0x0f;
	let truncated =
		((digest[offset] & 0x7f) << 24) |
		((digest[offset + 1] & 0xff) << 16) |
		((digest[offset + 2] & 0xff) << 8) |
		(digest[offset + 3] & 0xff);
	const alphabet = "23456789BCDFGHJKMNPQRTVWXY";
	let code = "";
	for (let index = 0; index < 5; index += 1) {
		code += alphabet[truncated % alphabet.length];
		truncated = Math.floor(truncated / alphabet.length);
	}
	return code;
}

export async function calcTotpNow(
	rawSecret: string,
	nowMs: number = Date.now(),
): Promise<{ code: string; remain: number } | null> {
	const config = parseTotpConfig(rawSecret);
	if (!config.secret) return null;
	const epoch = Math.floor(nowMs / 1000);
	const counter = Math.floor(epoch / config.period);
	const remain = config.period - (epoch % config.period);

	if (config.steam) {
		const code = await generateSteamCode(config.secret, counter);
		return code ? { code, remain } : null;
	}

	try {
		const totp = new OTPAuth.TOTP({
			secret: OTPAuth.Secret.fromBase32(config.secret),
			algorithm: config.algorithm,
			digits: config.digits,
			period: config.period,
		});
		return { code: totp.generate({ timestamp: nowMs }), remain };
	} catch {
		return null;
	}
}
