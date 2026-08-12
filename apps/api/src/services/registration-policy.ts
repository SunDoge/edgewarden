import type { CompiledQuery, Kysely } from "kysely";
import type { DB } from "../types/db";
import type { WorkerBindings } from "../worker-bindings";
import { getConfigValue, setConfigValueQuery } from "./db/config";

export const REGISTRATION_CONFIG_KEY = "registration.policy.v1";
export const BOOTSTRAP_LOCK_KEY = "registration.bootstrap.completed";

export interface RegistrationPolicy {
	signupsAllowed: boolean;
	invitationsAllowed: boolean;
}

function booleanSetting(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function defaultRegistrationPolicy(
	env: WorkerBindings,
): RegistrationPolicy {
	return {
		signupsAllowed: booleanSetting(env.SIGNUPS_ALLOWED, false),
		invitationsAllowed: booleanSetting(env.INVITATIONS_ALLOWED, true),
	};
}

export async function loadRegistrationPolicy(
	db: Kysely<DB>,
	env: WorkerBindings,
): Promise<RegistrationPolicy> {
	const fallback = defaultRegistrationPolicy(env);
	const value = await getConfigValue(db, REGISTRATION_CONFIG_KEY);
	if (!value) return fallback;
	try {
		const parsed = JSON.parse(value) as Partial<RegistrationPolicy>;
		return {
			signupsAllowed:
				typeof parsed.signupsAllowed === "boolean"
					? parsed.signupsAllowed
					: fallback.signupsAllowed,
			invitationsAllowed:
				typeof parsed.invitationsAllowed === "boolean"
					? parsed.invitationsAllowed
					: fallback.invitationsAllowed,
		};
	} catch {
		return fallback;
	}
}

export function registrationPolicyQuery(
	db: Kysely<DB>,
	policy: RegistrationPolicy,
): CompiledQuery {
	return setConfigValueQuery(
		db,
		REGISTRATION_CONFIG_KEY,
		JSON.stringify(policy),
	);
}

export function adminPasswordConfigured(env: WorkerBindings): boolean {
	return Boolean((env.BOOTSTRAP_SECRET ?? env.ADMIN_PASSWORD)?.trim());
}

async function digest(value: string): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	);
}

export async function verifyBootstrapSecret(
	env: WorkerBindings,
	candidate: string | undefined,
): Promise<boolean> {
	const configured = env.BOOTSTRAP_SECRET ?? env.ADMIN_PASSWORD;
	if (!configured?.trim() || !candidate) return false;
	const [expectedBytes, candidateBytes] = await Promise.all([
		digest(configured),
		digest(candidate),
	]);
	let difference = 0;
	for (let index = 0; index < expectedBytes.length; index += 1)
		difference |= expectedBytes[index] ^ candidateBytes[index];
	return difference === 0;
}

export function inviteConsumptionLockKey(code: string): string {
	return `registration.invite.used:${code}`;
}
