import assert from "node:assert/strict";
import { test } from "vitest";
import { createDatabase } from "../middleware/db";
import {
	conditionalAccountPasskeyClaimQuery,
	conditionalUserRevisionQuery,
	conditionalWebauthnCredentialDeletionClaimQuery,
	conditionalWebauthnCredentialDeletionQuery,
	conditionalWebauthnCredentialInsertQuery,
	conditionalWebauthnEncryptionRevisionQuery,
	conditionalWebauthnEncryptionUpdateQuery,
} from "../services/db/batch";
import * as webauthnDb from "../services/db/webauthn";

export interface AuthReliabilityScenarioContext {
	readonly database: D1Database;
	email: string;
}

export function registerAuthReliabilityScenarios(
	context: AuthReliabilityScenarioContext,
): void {
	test("adds one login passkey from a shared security snapshot", async () => {
		const { db, dialect } = await createDatabase(context.database);
		const user = await db
			.selectFrom("users")
			.select(["id", "security_stamp"])
			.where("email", "=", context.email)
			.executeTakeFirstOrThrow();
		const revision = await db
			.selectFrom("user_revisions")
			.select("revision_date")
			.where("user_id", "=", user.id)
			.executeTakeFirstOrThrow();
		const timestamp = Math.floor(Date.now() / 1000);
		const ids = [crypto.randomUUID(), crypto.randomUUID()];
		try {
			const affected: Array<[bigint, bigint]> = [];
			for (const [attempt, id] of ids.entries()) {
				const securityStamp = crypto.randomUUID();
				const credential = {
					id,
					user_id: user.id,
					purpose: "login",
					name: `Concurrent login passkey ${attempt}`,
					public_key: "AQID",
					credential_id: `login-credential-${id}`,
					counter: 0,
					type: "public-key",
					aa_guid: null,
					transports: "[]",
					encrypted_user_key: null,
					encrypted_public_key: null,
					encrypted_private_key: null,
					supports_prf: 0,
					mutation_token: crypto.randomUUID(),
					created_at: timestamp,
					updated_at: timestamp,
				};
				const [claimed, inserted] = await dialect.batch([
					conditionalAccountPasskeyClaimQuery(
						db,
						user.id,
						user.security_stamp,
						credential.credential_id,
						securityStamp,
						5,
						timestamp,
					),
					conditionalWebauthnCredentialInsertQuery(
						db,
						credential,
						securityStamp,
					),
					conditionalUserRevisionQuery(db, user.id, securityStamp, timestamp),
				]);
				affected.push([
					claimed.numAffectedRows ?? 0n,
					inserted.numAffectedRows ?? 0n,
				]);
			}
			assert.deepEqual(affected, [
				[1n, 1n],
				[0n, 0n],
			]);
			const after = await db
				.selectFrom("user_revisions")
				.select("revision_date")
				.where("user_id", "=", user.id)
				.executeTakeFirstOrThrow();
			assert.equal(after.revision_date, revision.revision_date + 1);
		} finally {
			await db
				.deleteFrom("webauthn_credentials")
				.where("id", "in", ids)
				.execute();
			await db
				.updateTable("users")
				.set({ security_stamp: user.security_stamp })
				.where("id", "=", user.id)
				.execute();
			await db
				.updateTable("user_revisions")
				.set({ revision_date: revision.revision_date })
				.where("user_id", "=", user.id)
				.execute();
			await db.destroy();
		}
	});

	test("removes one login passkey from a shared security snapshot", async () => {
		const { db, dialect } = await createDatabase(context.database);
		const user = await db
			.selectFrom("users")
			.select(["id", "security_stamp"])
			.where("email", "=", context.email)
			.executeTakeFirstOrThrow();
		const revision = await db
			.selectFrom("user_revisions")
			.select("revision_date")
			.where("user_id", "=", user.id)
			.executeTakeFirstOrThrow();
		const timestamp = Math.floor(Date.now() / 1000);
		const id = crypto.randomUUID();
		try {
			await db
				.insertInto("webauthn_credentials")
				.values({
					id,
					user_id: user.id,
					purpose: "login",
					name: "Concurrent deletion login passkey",
					public_key: "AQID",
					credential_id: `delete-login-credential-${id}`,
					counter: 0,
					type: "public-key",
					aa_guid: null,
					transports: "[]",
					encrypted_user_key: null,
					encrypted_public_key: null,
					encrypted_private_key: null,
					supports_prf: 0,
					created_at: timestamp,
					updated_at: timestamp,
				})
				.execute();
			const affected: Array<[bigint, bigint]> = [];
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const securityStamp = crypto.randomUUID();
				const [claimed, deleted] = await dialect.batch([
					conditionalWebauthnCredentialDeletionClaimQuery(
						db,
						user.id,
						id,
						"login",
						user.security_stamp,
						securityStamp,
						timestamp,
					),
					conditionalWebauthnCredentialDeletionQuery(
						db,
						user.id,
						id,
						"login",
						securityStamp,
					),
					conditionalUserRevisionQuery(db, user.id, securityStamp, timestamp),
				]);
				affected.push([
					claimed.numAffectedRows ?? 0n,
					deleted.numAffectedRows ?? 0n,
				]);
			}
			assert.deepEqual(affected, [
				[1n, 1n],
				[0n, 0n],
			]);
			const after = await db
				.selectFrom("user_revisions")
				.select("revision_date")
				.where("user_id", "=", user.id)
				.executeTakeFirstOrThrow();
			assert.equal(after.revision_date, revision.revision_date + 1);
		} finally {
			await db
				.deleteFrom("webauthn_credentials")
				.where("id", "=", id)
				.execute();
			await db
				.updateTable("users")
				.set({ security_stamp: user.security_stamp })
				.where("id", "=", user.id)
				.execute();
			await db
				.updateTable("user_revisions")
				.set({ revision_date: revision.revision_date })
				.where("user_id", "=", user.id)
				.execute();
			await db.destroy();
		}
	});

	test("never moves a WebAuthn signature counter backwards", async () => {
		const { db } = await createDatabase(context.database);
		const user = await db
			.selectFrom("users")
			.select("id")
			.where("email", "=", context.email)
			.executeTakeFirstOrThrow();
		const timestamp = Math.floor(Date.now() / 1000);
		const id = crypto.randomUUID();
		const credentialId = `counter-credential-${id}`;
		try {
			await db
				.insertInto("webauthn_credentials")
				.values({
					id,
					user_id: user.id,
					purpose: "login",
					name: "Concurrent counter passkey",
					public_key: "AQID",
					credential_id: credentialId,
					counter: 0,
					type: "public-key",
					aa_guid: null,
					transports: "[]",
					encrypted_user_key: null,
					encrypted_public_key: null,
					encrypted_private_key: null,
					supports_prf: 0,
					created_at: timestamp,
					updated_at: timestamp,
				})
				.execute();
			const updates = await Promise.all(
				Array.from({ length: 8 }, (_, index) =>
					webauthnDb.updateAccountPasskeyCounter(
						db,
						user.id,
						credentialId,
						0,
						index + 1,
					),
				),
			);
			assert.equal(updates.filter(Boolean).length, 1);
			const winner = await db
				.selectFrom("webauthn_credentials")
				.select("counter")
				.where("id", "=", id)
				.executeTakeFirstOrThrow();
			assert.ok(winner.counter >= 1 && winner.counter <= 8);
			assert.equal(
				await webauthnDb.updateAccountPasskeyCounter(
					db,
					user.id,
					credentialId,
					0,
					9,
				),
				false,
			);
			assert.equal(
				(
					await db
						.selectFrom("webauthn_credentials")
						.select("counter")
						.where("id", "=", id)
						.executeTakeFirstOrThrow()
				).counter,
				winner.counter,
			);
		} finally {
			await db
				.deleteFrom("webauthn_credentials")
				.where("id", "=", id)
				.execute();
			await db.destroy();
		}
	});

	test("updates a passkey PRF key set once from a shared snapshot", async () => {
		const { db, dialect } = await createDatabase(context.database);
		const user = await db
			.selectFrom("users")
			.select("id")
			.where("email", "=", context.email)
			.executeTakeFirstOrThrow();
		const revision = await db
			.selectFrom("user_revisions")
			.select("revision_date")
			.where("user_id", "=", user.id)
			.executeTakeFirstOrThrow();
		const timestamp = Math.floor(Date.now() / 1000);
		const id = crypto.randomUUID();
		try {
			const credential = {
				id,
				user_id: user.id,
				purpose: "login",
				name: "Concurrent PRF passkey",
				public_key: "AQID",
				credential_id: `prf-credential-${id}`,
				counter: 0,
				type: "public-key",
				aa_guid: null,
				transports: "[]",
				encrypted_user_key: null,
				encrypted_public_key: null,
				encrypted_private_key: null,
				supports_prf: 0,
				mutation_token: crypto.randomUUID(),
				created_at: timestamp,
				updated_at: timestamp,
			};
			await db.insertInto("webauthn_credentials").values(credential).execute();
			const affected: bigint[] = [];
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const encryptedUserKey = "shared-user-key";
				const encryptedPublicKey = "shared-public-key";
				const encryptedPrivateKey = "shared-private-key";
				const mutationToken = crypto.randomUUID();
				const [updated] = await dialect.batch([
					conditionalWebauthnEncryptionUpdateQuery(
						db,
						credential,
						encryptedUserKey,
						encryptedPublicKey,
						encryptedPrivateKey,
						mutationToken,
						timestamp,
					),
					conditionalWebauthnEncryptionRevisionQuery(
						db,
						user.id,
						id,
						mutationToken,
						timestamp,
					),
				]);
				affected.push(updated.numAffectedRows ?? 0n);
			}
			assert.deepEqual(affected, [1n, 0n]);
			assert.deepEqual(
				await db
					.selectFrom("webauthn_credentials")
					.select([
						"encrypted_user_key",
						"encrypted_public_key",
						"encrypted_private_key",
						"supports_prf",
					])
					.where("id", "=", id)
					.executeTakeFirstOrThrow(),
				{
					encrypted_user_key: "shared-user-key",
					encrypted_public_key: "shared-public-key",
					encrypted_private_key: "shared-private-key",
					supports_prf: 1,
				},
			);
			const after = await db
				.selectFrom("user_revisions")
				.select("revision_date")
				.where("user_id", "=", user.id)
				.executeTakeFirstOrThrow();
			assert.equal(after.revision_date, revision.revision_date + 1);
		} finally {
			await db
				.deleteFrom("webauthn_credentials")
				.where("id", "=", id)
				.execute();
			await db
				.updateTable("user_revisions")
				.set({ revision_date: revision.revision_date })
				.where("user_id", "=", user.id)
				.execute();
			await db.destroy();
		}
	});
}
