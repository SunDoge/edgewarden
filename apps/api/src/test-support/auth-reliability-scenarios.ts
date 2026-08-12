import assert from "node:assert/strict";
import { test } from "vitest";
import { createDatabase } from "../middleware/db";
import { generateAccessToken, verifyAccessToken } from "../services/auth";
import {
	conditionalAccountPasskeyClaimQuery,
	conditionalAllDevicesDeletionClaimQuery,
	conditionalAllDevicesDeletionQuery,
	conditionalDeviceTrustTokenDeletionQuery,
	conditionalUserRevisionQuery,
	conditionalWebauthnCredentialDeletionClaimQuery,
	conditionalWebauthnCredentialDeletionQuery,
	conditionalWebauthnCredentialInsertQuery,
	conditionalWebauthnEncryptionRevisionQuery,
	conditionalWebauthnEncryptionUpdateQuery,
} from "../services/db/batch";
import * as webauthnDb from "../services/db/webauthn";
import { refreshTokenRotationInsertQuery } from "../services/identity-refresh";
import { issueIdentitySession } from "../services/identity-session";
import {
	clearLoginFailures,
	isLoginLocked,
	loginAttemptIdentifierHash,
	recordLoginFailure,
} from "../services/login-attempts";

export interface AuthReliabilityScenarioContext {
	readonly database: D1Database;
	email: string;
}

export function registerAuthReliabilityScenarios(
	context: AuthReliabilityScenarioContext,
): void {
	test("counts concurrent login failures without lost updates", async () => {
		const email = `concurrent-failures-${crypto.randomUUID()}@example.com`;
		const connections = await Promise.all(
			Array.from({ length: 12 }, () => createDatabase(context.database)),
		);
		try {
			await Promise.all(
				connections.map(({ db }) => recordLoginFailure(db, email)),
			);
			const stored = await connections[0].db
				.selectFrom("login_attempts")
				.select(["failure_count", "locked_until"])
				.where("identifier_hash", "=", await loginAttemptIdentifierHash(email))
				.executeTakeFirstOrThrow();
			assert.equal(stored.failure_count, connections.length);
			assert.ok(stored.locked_until);
			assert.equal(await isLoginLocked(connections[0].db, email), true);
			await clearLoginFailures(connections[0].db, email);
		} finally {
			await Promise.all(connections.map(({ db }) => db.destroy()));
		}
	});

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

	test("deletes all devices only from a current active account snapshot", async () => {
		const { db, dialect } = await createDatabase(context.database);
		const timestamp = Math.floor(Date.now() / 1000);
		const user = {
			id: crypto.randomUUID(),
			email: `delete-all-${crypto.randomUUID()}@example.com`,
			master_password_hash: "isolated-test-hash",
			key: "isolated-test-key",
			kdf_type: 0,
			kdf_iterations: 600_000,
			kdf_memory: null,
			kdf_parallelism: null,
			security_stamp: crypto.randomUUID(),
			created_at: timestamp,
			updated_at: timestamp,
			deletion_requested_at: null,
		};
		const deviceId = `delete-all-${crypto.randomUUID()}`;
		try {
			await db.insertInto("users").values(user).execute();
			await db
				.insertInto("devices")
				.values({
					user_id: user.id,
					device_identifier: deviceId,
					name: "Delete all reliability device",
					type: 14,
					session_stamp: crypto.randomUUID(),
					mutation_token: crypto.randomUUID(),
					created_at: timestamp,
					updated_at: timestamp,
				})
				.execute();
			await db
				.insertInto("device_trust_tokens")
				.values({
					token: crypto.randomUUID(),
					user_id: user.id,
					device_identifier: deviceId,
					expires_at: timestamp + 3600,
				})
				.execute();
			const affected: bigint[] = [];
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const securityStamp = crypto.randomUUID();
				const [claimed] = await dialect.batch([
					conditionalAllDevicesDeletionClaimQuery(
						db,
						user.id,
						user.security_stamp,
						securityStamp,
						timestamp,
					),
					conditionalDeviceTrustTokenDeletionQuery(db, user.id, securityStamp),
					conditionalAllDevicesDeletionQuery(db, user.id, securityStamp),
				]);
				affected.push(claimed.numAffectedRows ?? 0n);
			}
			assert.deepEqual(affected, [1n, 0n]);
			assert.equal(
				await db
					.selectFrom("devices")
					.select(({ fn }) => fn.countAll<number>().as("count"))
					.where("device_identifier", "=", deviceId)
					.executeTakeFirstOrThrow()
					.then((row) => Number(row.count)),
				0,
			);

			await db
				.updateTable("users")
				.set({
					security_stamp: user.security_stamp,
					deletion_requested_at: timestamp,
				})
				.where("id", "=", user.id)
				.execute();
			const blocked = await dialect.batch([
				conditionalAllDevicesDeletionClaimQuery(
					db,
					user.id,
					user.security_stamp,
					crypto.randomUUID(),
					timestamp,
				),
			]);
			assert.equal(blocked[0].numAffectedRows, 0n);
		} finally {
			await db
				.deleteFrom("device_trust_tokens")
				.where("device_identifier", "=", deviceId)
				.execute();
			await db
				.deleteFrom("devices")
				.where("device_identifier", "=", deviceId)
				.execute();
			await db.deleteFrom("users").where("id", "=", user.id).execute();
			await db.destroy();
		}
	});

	test("consumes a WebAuthn challenge atomically within its scope", async () => {
		const { db } = await createDatabase(context.database);
		const user = await db
			.selectFrom("users")
			.select("id")
			.where("email", "=", context.email)
			.executeTakeFirstOrThrow();
		const timestamp = Math.floor(Date.now() / 1000);
		const challengeHash = `challenge-${crypto.randomUUID()}`;
		const ownerHash = `owner-${crypto.randomUUID()}`;
		const expiredHash = `expired-${crypto.randomUUID()}`;
		const hashes = [challengeHash, ownerHash, expiredHash];
		try {
			await db
				.insertInto("webauthn_challenges")
				.values([
					{
						challenge_hash: challengeHash,
						scope: "action",
						user_id: user.id,
						expires_at: timestamp + 60,
						used_at: null,
						created_at: timestamp,
					},
					{
						challenge_hash: ownerHash,
						scope: "action",
						user_id: user.id,
						expires_at: timestamp + 60,
						used_at: null,
						created_at: timestamp,
					},
					{
						challenge_hash: expiredHash,
						scope: "action",
						user_id: user.id,
						expires_at: timestamp - 1,
						used_at: null,
						created_at: timestamp - 60,
					},
				])
				.execute();
			const consumed = await Promise.all(
				Array.from({ length: 8 }, () =>
					webauthnDb.consumeAccountPasskeyChallenge(
						db,
						challengeHash,
						"action",
						user.id,
					),
				),
			);
			assert.equal(consumed.filter(Boolean).length, 1);
			assert.equal(
				await webauthnDb.consumeAccountPasskeyChallenge(
					db,
					ownerHash,
					"action",
					crypto.randomUUID(),
				),
				null,
			);
			assert.ok(
				await webauthnDb.consumeAccountPasskeyChallenge(
					db,
					ownerHash,
					"action",
					user.id,
				),
			);
			assert.equal(
				await webauthnDb.consumeAccountPasskeyChallenge(
					db,
					expiredHash,
					"action",
					user.id,
				),
				null,
			);
		} finally {
			await db
				.deleteFrom("webauthn_challenges")
				.where("challenge_hash", "in", hashes)
				.execute();
			await db.destroy();
		}
	});

	test("revalidates account and device state during refresh rotation", async () => {
		const { db, dialect } = await createDatabase(context.database);
		const timestamp = Math.floor(Date.now() / 1000);
		const userId = crypto.randomUUID();
		const originalStamp = crypto.randomUUID();
		const deviceId = `refresh-device-${crypto.randomUUID()}`;
		const originalDeviceStamp = crypto.randomUUID();
		const oldTokenHash = `old-refresh-${crypto.randomUUID()}`;
		const insertedHashes: string[] = [];
		const insertOldToken = () =>
			db
				.insertInto("refresh_tokens")
				.values({
					token: oldTokenHash,
					user_id: userId,
					expires_at: timestamp + 3600,
					device_identifier: deviceId,
					device_session_stamp: originalDeviceStamp,
				})
				.execute();
		const rotate = async (newTokenHash: string) => {
			insertedHashes.push(newTokenHash);
			const [inserted] = await dialect.batch([
				refreshTokenRotationInsertQuery(db, {
					oldTokenHash,
					newTokenHash,
					userId,
					expectedSecurityStamp: originalStamp,
					sessionTime: timestamp,
				}),
				db
					.deleteFrom("refresh_tokens")
					.where("token", "=", oldTokenHash)
					.compile(),
			]);
			return inserted.numAffectedRows ?? 0n;
		};
		try {
			await db
				.insertInto("users")
				.values({
					id: userId,
					email: `refresh-${crypto.randomUUID()}@example.com`,
					master_password_hash: "isolated-refresh-hash",
					key: "isolated-refresh-key",
					kdf_type: 0,
					kdf_iterations: 600_000,
					kdf_memory: null,
					kdf_parallelism: null,
					security_stamp: originalStamp,
					created_at: timestamp,
					updated_at: timestamp,
				})
				.execute();
			await db
				.insertInto("devices")
				.values({
					user_id: userId,
					device_identifier: deviceId,
					name: "Refresh reliability device",
					type: 14,
					session_stamp: originalDeviceStamp,
					mutation_token: crypto.randomUUID(),
					created_at: timestamp,
					updated_at: timestamp,
				})
				.execute();

			await insertOldToken();
			await db
				.updateTable("users")
				.set({ security_stamp: crypto.randomUUID() })
				.where("id", "=", userId)
				.execute();
			assert.equal(await rotate(`new-user-${crypto.randomUUID()}`), 0n);

			await db
				.updateTable("users")
				.set({ security_stamp: originalStamp })
				.where("id", "=", userId)
				.execute();
			await insertOldToken();
			await db
				.updateTable("devices")
				.set({ session_stamp: crypto.randomUUID() })
				.where("user_id", "=", userId)
				.where("device_identifier", "=", deviceId)
				.execute();
			assert.equal(await rotate(`new-device-${crypto.randomUUID()}`), 0n);

			await db
				.updateTable("devices")
				.set({ session_stamp: originalDeviceStamp })
				.where("user_id", "=", userId)
				.where("device_identifier", "=", deviceId)
				.execute();
			await insertOldToken();
			const validHash = `new-valid-${crypto.randomUUID()}`;
			assert.equal(await rotate(validHash), 1n);
			assert.deepEqual(
				await db
					.selectFrom("refresh_tokens")
					.select(["user_id", "device_identifier", "device_session_stamp"])
					.where("token", "=", validHash)
					.executeTakeFirstOrThrow(),
				{
					user_id: userId,
					device_identifier: deviceId,
					device_session_stamp: originalDeviceStamp,
				},
			);
		} finally {
			await db
				.deleteFrom("refresh_tokens")
				.where("token", "in", [oldTokenHash, ...insertedHashes])
				.execute();
			await db.deleteFrom("users").where("id", "=", userId).execute();
			await db.destroy();
		}
	});

	test("does not issue a session from a stale user snapshot", async () => {
		const { db, dialect } = await createDatabase(context.database);
		const timestamp = Math.floor(Date.now() / 1000);
		const userId = crypto.randomUUID();
		const securityStamp = crypto.randomUUID();
		let issued: Awaited<ReturnType<typeof issueIdentitySession>> = null;
		try {
			await db
				.insertInto("users")
				.values({
					id: userId,
					email: `stale-session-${crypto.randomUUID()}@example.com`,
					master_password_hash: "isolated-session-hash",
					key: "isolated-session-key",
					kdf_type: 0,
					kdf_iterations: 600_000,
					kdf_memory: null,
					kdf_parallelism: null,
					security_stamp: securityStamp,
					created_at: timestamp,
					updated_at: timestamp,
				})
				.execute();
			const snapshot = await db
				.selectFrom("users")
				.selectAll()
				.where("id", "=", userId)
				.executeTakeFirstOrThrow();
			await db
				.updateTable("users")
				.set({ security_stamp: crypto.randomUUID() })
				.where("id", "=", userId)
				.execute();
			assert.equal(
				await issueIdentitySession({
					db,
					dialect,
					user: snapshot,
					device: { identifier: "", name: "", type: 0 },
					jwtSecret: "stale-session-test-secret-at-least-32-chars",
				}),
				null,
			);
			assert.equal(
				await db
					.selectFrom("refresh_tokens")
					.select(({ fn }) => fn.countAll<number>().as("count"))
					.where("user_id", "=", userId)
					.executeTakeFirstOrThrow()
					.then((row) => Number(row.count)),
				0,
			);
			assert.equal(
				await db
					.selectFrom("user_revisions")
					.select("user_id")
					.where("user_id", "=", userId)
					.executeTakeFirst(),
				undefined,
			);

			await db
				.updateTable("users")
				.set({ security_stamp: securityStamp })
				.where("id", "=", userId)
				.execute();
			issued = await issueIdentitySession({
				db,
				dialect,
				user: snapshot,
				device: { identifier: "", name: "", type: 0 },
				jwtSecret: "stale-session-test-secret-at-least-32-chars",
			});
			assert.ok(issued);
		} finally {
			await db.deleteFrom("users").where("id", "=", userId).execute();
			await db.destroy();
		}
	});

	test("rejects revoked JWT state without isolate-local invalidation", async () => {
		const { db } = await createDatabase(context.database);
		const timestamp = Math.floor(Date.now() / 1000);
		const userId = crypto.randomUUID();
		const userStamp = crypto.randomUUID();
		const deviceId = `jwt-device-${crypto.randomUUID()}`;
		const deviceStamp = crypto.randomUUID();
		const jwtSecret = "cross-isolate-revocation-test-secret-32-chars";
		try {
			await db
				.insertInto("users")
				.values({
					id: userId,
					email: `jwt-state-${crypto.randomUUID()}@example.com`,
					master_password_hash: "isolated-jwt-hash",
					key: "isolated-jwt-key",
					kdf_type: 0,
					kdf_iterations: 600_000,
					kdf_memory: null,
					kdf_parallelism: null,
					security_stamp: userStamp,
					created_at: timestamp,
					updated_at: timestamp,
				})
				.execute();
			await db
				.insertInto("devices")
				.values({
					user_id: userId,
					device_identifier: deviceId,
					name: "JWT revocation device",
					type: 14,
					session_stamp: deviceStamp,
					mutation_token: crypto.randomUUID(),
					created_at: timestamp,
					updated_at: timestamp,
				})
				.execute();
			const user = await db
				.selectFrom("users")
				.selectAll()
				.where("id", "=", userId)
				.executeTakeFirstOrThrow();
			const token = await generateAccessToken(
				user,
				{ identifier: deviceId, sessionStamp: deviceStamp },
				jwtSecret,
			);
			const authorization = `Bearer ${token}`;
			assert.ok(await verifyAccessToken(authorization, db, jwtSecret));

			await db
				.updateTable("users")
				.set({ security_stamp: crypto.randomUUID() })
				.where("id", "=", userId)
				.execute();
			assert.equal(await verifyAccessToken(authorization, db, jwtSecret), null);

			await db
				.updateTable("users")
				.set({ security_stamp: userStamp })
				.where("id", "=", userId)
				.execute();
			assert.ok(await verifyAccessToken(authorization, db, jwtSecret));
			await db
				.updateTable("devices")
				.set({ session_stamp: crypto.randomUUID() })
				.where("user_id", "=", userId)
				.where("device_identifier", "=", deviceId)
				.execute();
			assert.equal(await verifyAccessToken(authorization, db, jwtSecret), null);
		} finally {
			await db.deleteFrom("users").where("id", "=", userId).execute();
			await db.destroy();
		}
	});
}
