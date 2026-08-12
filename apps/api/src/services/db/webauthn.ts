import type { Insertable, Kysely, Selectable } from "kysely";
import type {
	DB,
	WebauthnChallenges,
	WebauthnCredentials,
} from "../../types/db";
import { now } from "../../utils/time";

export type WebauthnCredentialPurpose = "login" | "twoFactor";

export async function saveAccountPasskeyCredential(
	db: Kysely<DB>,
	credential: Omit<
		Insertable<WebauthnCredentials>,
		"created_at" | "updated_at"
	> & {
		created_at?: number;
		updated_at?: number;
	},
): Promise<void> {
	const ts = now();
	const values = {
		...credential,
		mutation_token: credential.mutation_token ?? crypto.randomUUID(),
		created_at: credential.created_at ?? ts,
		updated_at: credential.updated_at ?? ts,
	};

	await db
		.insertInto("webauthn_credentials")
		.values(values)
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({
				name: values.name,
				public_key: values.public_key,
				credential_id: values.credential_id,
				counter: values.counter,
				type: values.type,
				aa_guid: values.aa_guid,
				transports: values.transports,
				encrypted_user_key: values.encrypted_user_key,
				encrypted_public_key: values.encrypted_public_key,
				encrypted_private_key: values.encrypted_private_key,
				supports_prf: values.supports_prf,
				mutation_token: values.mutation_token,
				updated_at: values.updated_at,
			}),
		)
		.execute();
}

export async function listAccountPasskeyCredentialsByUserId(
	db: Kysely<DB>,
	userId: string,
	purpose: WebauthnCredentialPurpose = "login",
): Promise<Selectable<WebauthnCredentials>[]> {
	return await db
		.selectFrom("webauthn_credentials")
		.selectAll()
		.where("user_id", "=", userId)
		.where("purpose", "=", purpose)
		.orderBy("created_at", "asc")
		.execute();
}

export async function listAllAccountPasskeyCredentialsByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<WebauthnCredentials>[]> {
	return db
		.selectFrom("webauthn_credentials")
		.selectAll()
		.where("user_id", "=", userId)
		.orderBy("created_at", "asc")
		.execute();
}

export async function getAccountPasskeyCredentialById(
	db: Kysely<DB>,
	userId: string,
	id: string,
	purpose: WebauthnCredentialPurpose = "login",
): Promise<Selectable<WebauthnCredentials> | null> {
	return (
		(await db
			.selectFrom("webauthn_credentials")
			.selectAll()
			.where("user_id", "=", userId)
			.where("id", "=", id)
			.where("purpose", "=", purpose)
			.executeTakeFirst()) ?? null
	);
}

export async function getAccountPasskeyCredentialByCredentialId(
	db: Kysely<DB>,
	credentialId: string,
	purpose: WebauthnCredentialPurpose = "login",
): Promise<Selectable<WebauthnCredentials> | null> {
	return (
		(await db
			.selectFrom("webauthn_credentials")
			.selectAll()
			.where("credential_id", "=", credentialId)
			.where("purpose", "=", purpose)
			.executeTakeFirst()) ?? null
	);
}

export async function countAccountPasskeyCredentialsByUserId(
	db: Kysely<DB>,
	userId: string,
	purpose: WebauthnCredentialPurpose = "login",
): Promise<number> {
	const row = await db
		.selectFrom("webauthn_credentials")
		.select((eb) => eb.fn.countAll<number>().as("count"))
		.where("user_id", "=", userId)
		.where("purpose", "=", purpose)
		.executeTakeFirst();
	return Number(row?.count ?? 0);
}

export async function updateAccountPasskeyCounter(
	db: Kysely<DB>,
	userId: string,
	credentialId: string,
	expectedCounter: number,
	counter: number,
): Promise<boolean> {
	// Authenticators without a signature counter report zero forever. Keep the
	// conditional write even then so deletion racing an assertion is detected.
	if (
		counter < expectedCounter ||
		(counter === expectedCounter && counter !== 0)
	)
		return false;
	const result = await db
		.updateTable("webauthn_credentials")
		.set({
			counter,
			updated_at: now(),
		})
		.where("user_id", "=", userId)
		.where("credential_id", "=", credentialId)
		.where("counter", "=", expectedCounter)
		.executeTakeFirst();
	return result.numUpdatedRows === 1n;
}

export async function deleteAccountPasskeyCredential(
	db: Kysely<DB>,
	userId: string,
	id: string,
	purpose: WebauthnCredentialPurpose = "login",
): Promise<boolean> {
	const result = await db
		.deleteFrom("webauthn_credentials")
		.where("user_id", "=", userId)
		.where("id", "=", id)
		.where("purpose", "=", purpose)
		.executeTakeFirst();
	return Number(result.numDeletedRows ?? 0) > 0;
}

export async function saveAccountPasskeyChallenge(
	db: Kysely<DB>,
	challenge: Insertable<WebauthnChallenges>,
): Promise<void> {
	const ts = now();
	// Keep challenge creation to one indexed cleanup query. Consumed challenges
	// are harmless until expiry and scheduled maintenance removes them sooner.
	await db
		.deleteFrom("webauthn_challenges")
		.where("expires_at", "<", ts)
		.execute();

	await db
		.insertInto("webauthn_challenges")
		.values(challenge)
		.onConflict((oc) =>
			oc.column("challenge_hash").doUpdateSet({
				scope: challenge.scope,
				user_id: challenge.user_id,
				expires_at: challenge.expires_at,
				used_at: challenge.used_at,
				created_at: challenge.created_at,
			}),
		)
		.execute();
}

export async function consumeAccountPasskeyChallenge(
	db: Kysely<DB>,
	challengeHash: string,
	scope: string,
	userId: string | null,
): Promise<Selectable<WebauthnChallenges> | null> {
	const ts = now();
	const challenge = await db
		.selectFrom("webauthn_challenges")
		.selectAll()
		.where("challenge_hash", "=", challengeHash)
		.where("scope", "=", scope)
		.executeTakeFirst();

	if (!challenge) return null;
	if (challenge.used_at !== null || challenge.expires_at < ts) return null;
	if (userId !== null && challenge.user_id !== userId) return null;
	if (userId === null && challenge.user_id !== null) return null;

	const result = await db
		.updateTable("webauthn_challenges")
		.set({ used_at: ts })
		.where("challenge_hash", "=", challengeHash)
		.where("used_at", "is", null)
		.executeTakeFirst();

	if (Number(result.numUpdatedRows ?? 0) <= 0) return null;
	return { ...challenge, used_at: ts };
}
