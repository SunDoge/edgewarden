import type { D1Dialect } from "@sundoge/kysely-d1";
import { type Insertable, type Kysely, type Selectable, sql } from "kysely";
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
	let query = db
		.updateTable("webauthn_challenges")
		.set({ used_at: ts })
		.where("challenge_hash", "=", challengeHash)
		.where("scope", "=", scope)
		.where("used_at", "is", null)
		.where("expires_at", ">", ts);
	query =
		userId !== null
			? query.where("user_id", "=", userId)
			: query.where("user_id", "is", null);
	return (await query.returningAll().executeTakeFirst()) ?? null;
}

export async function claimVerifiedPasskeyAssertion(
	db: Kysely<DB>,
	dialect: D1Dialect,
	args: {
		challengeHash: string;
		scope: string;
		challengeUserId: string | null;
		credentialUserId: string;
		credentialId: string;
		expectedCounter: number;
		newCounter: number;
	},
): Promise<string | null> {
	if (
		args.newCounter < args.expectedCounter ||
		(args.newCounter === args.expectedCounter && args.newCounter !== 0)
	)
		return null;
	const ts = now();
	const claimToken = crypto.randomUUID();
	const challengeOwner =
		args.challengeUserId === null
			? sql<boolean>`challenge.user_id IS NULL`
			: sql<boolean>`challenge.user_id = ${args.challengeUserId}`;
	const challengeEligible = sql<boolean>`
		challenge.challenge_hash = ${args.challengeHash}
		AND challenge.scope = ${args.scope}
		AND challenge.used_at IS NULL
		AND challenge.expires_at > ${ts}
		AND ${challengeOwner}
	`;
	const [counter, challenge] = await dialect.batch([
		sql`
			UPDATE webauthn_credentials
			SET counter = ${args.newCounter},
			    mutation_token = ${claimToken},
			    updated_at = ${ts}
			WHERE user_id = ${args.credentialUserId}
			  AND credential_id = ${args.credentialId}
			  AND counter = ${args.expectedCounter}
			  AND EXISTS (
			    SELECT 1 FROM webauthn_challenges challenge
			    WHERE ${challengeEligible}
			  )
		`.compile(db),
		sql`
			UPDATE webauthn_challenges AS challenge
			SET used_at = ${ts}
			WHERE ${challengeEligible}
			  AND EXISTS (
			    SELECT 1 FROM webauthn_credentials credential
			    WHERE credential.user_id = ${args.credentialUserId}
			      AND credential.credential_id = ${args.credentialId}
			      AND credential.counter = ${args.newCounter}
			      AND credential.mutation_token = ${claimToken}
			  )
		`.compile(db),
	]);
	return counter.numAffectedRows === 1n && challenge.numAffectedRows === 1n
		? claimToken
		: null;
}
