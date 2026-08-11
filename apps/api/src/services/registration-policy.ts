type RegistrationBindings = CloudflareBindings & {
	ADMIN_PASSWORD?: string;
	SIGNUPS_ALLOWED?: string;
	INVITATIONS_ALLOWED?: string;
};

function booleanSetting(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function registrationPolicy(env: CloudflareBindings) {
	const bindings = env as RegistrationBindings;
	return {
		signupsAllowed: booleanSetting(bindings.SIGNUPS_ALLOWED, false),
		invitationsAllowed: booleanSetting(bindings.INVITATIONS_ALLOWED, true),
		adminPasswordConfigured: Boolean(bindings.ADMIN_PASSWORD?.trim()),
	};
}

async function digest(value: string): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	);
}

export async function verifyAdminPassword(
	env: CloudflareBindings,
	candidate: string | undefined,
): Promise<boolean> {
	const configured = (env as RegistrationBindings).ADMIN_PASSWORD;
	if (!configured?.trim() || !candidate) return false;
	const [expectedBytes, candidateBytes] = await Promise.all([
		digest(configured),
		digest(candidate),
	]);
	let difference = 0;
	for (let index = 0; index < expectedBytes.length; index += 1) {
		difference |= expectedBytes[index] ^ candidateBytes[index];
	}
	return difference === 0;
}
