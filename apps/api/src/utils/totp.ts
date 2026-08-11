import * as OTPAuth from "otpauth";

export async function verifyTotpToken(
	secretRaw: string,
	token: string,
): Promise<boolean> {
	try {
		const totp = new OTPAuth.TOTP({
			secret: OTPAuth.Secret.fromBase32(secretRaw),
			digits: 6,
			period: 30,
		});
		return (
			totp.validate({ token: token.replace(/\s+/g, ""), window: 1 }) !== null
		);
	} catch {
		return false;
	}
}

export function isTotpEnabled(secret: string | null | undefined): boolean {
	return Boolean(secret?.trim());
}
