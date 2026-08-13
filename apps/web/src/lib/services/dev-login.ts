export interface DevLoginCredentials {
	email: string;
	password: string;
}

export function readDevLoginCredentials(
	isDev: boolean,
	env: Record<string, string | boolean | undefined>,
): DevLoginCredentials | null {
	if (!isDev || env.VITE_DEV_AUTO_LOGIN !== "true") return null;
	const email = String(env.VITE_DEV_EMAIL ?? "").trim();
	const password = String(env.VITE_DEV_PASSWORD ?? "");
	return email && password ? { email, password } : null;
}
