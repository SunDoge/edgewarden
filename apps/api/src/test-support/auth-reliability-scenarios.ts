import assert from "node:assert/strict";
import { test } from "vitest";
import { createDatabase } from "../middleware/db";
import {
	conditionalAccountPasskeyClaimQuery,
	conditionalUserRevisionQuery,
	conditionalWebauthnCredentialInsertQuery,
} from "../services/db/batch";

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
}
