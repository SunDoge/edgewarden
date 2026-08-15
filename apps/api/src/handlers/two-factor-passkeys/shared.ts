import { bytesToBase64Url } from "../../utils/passkey";
import { verifyPassword } from "../../services/auth";

// Challenges are stored as SHA-256 hashes so the replay guard does not retain the bearer challenge itself.
export const MAX_TWO_FACTOR_PASSKEYS = 5;

export function recoveryCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}

export async function verifySecret(
	user: any,
	body: Record<string, any>,
): Promise<boolean> {
	const secret = String(
		body.masterPasswordHash ??
			body.master_password_hash ??
			body.secret ??
			body.password ??
			"",
	).trim();
	return (
		!!secret && verifyPassword(secret, user.master_password_hash, user.email)
	);
}

export function settings(credentials: any[]) {
	return {
		enabled: credentials.length > 0,
		keys: credentials.map((credential) => ({
			id: credential.id,
			name: credential.name,
			migrated: false,
		})),
		object: "twoFactorWebAuthn",
	};
}

export async function challengeHash(challenge: string): Promise<string> {
	return bytesToBase64Url(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(challenge),
			),
		),
	);
}
