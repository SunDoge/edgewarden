import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { test } from "vitest";
import { createDatabase } from "../middleware/db";
import {
	acquireDataOperationLease,
	releaseDataOperationLease,
} from "../services/backup/operation-lease";
import { hashCredential } from "../services/credential-protection";
import { runMaintenance } from "../services/maintenance";

export interface AdminOrganizationScenarioContext {
	readonly database: D1Database;
	readonly bindings: CloudflareBindings;
	readonly accessToken: string;
	memberAccessToken: string;
	readonly cipherId: string;
	readonly sendId: string;
	organizationBackup: Uint8Array;
	backedUpOrganizationId: string;
	backedUpCollectionId: string;
	request: (path: string, init?: RequestInit) => Promise<Response>;
	email: string;
	memberEmail: string;
	masterPasswordHash: string;
}

export function registerAdminOrganizationScenarios(
	context: AdminOrganizationScenarioContext,
): void {
	const request = context.request;
	const EMAIL = context.email;
	const MEMBER_EMAIL = context.memberEmail;
	const MASTER_PASSWORD_HASH = context.masterPasswordHash;
	test("validates backup settings before normalization", async () => {
		const response = await request("/api/admin/backup/settings", {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				destinations: [{ type: "local", destination: {} }],
			}),
		});
		assert.equal(response.status, 400);
	});

	test("keeps backup settings reads free of D1 writes", async () => {
		const existing = await context.database
			.prepare("SELECT value FROM config WHERE key = 'backup.settings.v1'")
			.first<{ value: string }>();
		await context.database
			.prepare("DELETE FROM config WHERE key = 'backup.settings.v1'")
			.run();
		try {
			const response = await request("/api/admin/backup/settings", {
				headers: { authorization: `Bearer ${context.accessToken}` },
			});
			assert.equal(response.status, 200);
			const settings = await response.json<{ destinations: unknown[] }>();
			assert.equal(settings.destinations.length, 1);
			assert.equal(
				await context.database
					.prepare("SELECT value FROM config WHERE key = 'backup.settings.v1'")
					.first(),
				null,
			);
		} finally {
			if (existing) {
				await context.database
					.prepare(
						"INSERT INTO config (key, value) VALUES ('backup.settings.v1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
					)
					.bind(existing.value)
					.run();
			}
		}
	});

	test("does not overwrite backup settings while a data operation is running", async () => {
		const settingsResponse = await request("/api/admin/backup/settings", {
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.equal(settingsResponse.status, 200);
		const settings = await settingsResponse.json<unknown>();
		const before = await context.database
			.prepare("SELECT value FROM config WHERE key = 'backup.settings.v1'")
			.first<{ value: string }>();
		const lease = await acquireDataOperationLease(
			context.database,
			"backup.test",
		);
		assert.ok(lease);
		try {
			const response = await request("/api/admin/backup/settings", {
				method: "PUT",
				headers: {
					authorization: `Bearer ${context.accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(settings),
			});
			assert.equal(response.status, 409);
			assert.match(await response.text(), /operation is running/i);
			const after = await context.database
				.prepare("SELECT value FROM config WHERE key = 'backup.settings.v1'")
				.first<{ value: string }>();
			assert.deepEqual(after, before);
		} finally {
			await releaseDataOperationLease(context.database, lease);
		}
	});

	test("enforces admin authorization through shared middleware", async () => {
		const response = await request("/api/admin/backup/settings", {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(response.status, 403);
	});

	test("manages users and one-time invites with admin password re-verification", async () => {
		const adminAuth = { authorization: `Bearer ${context.accessToken}` };
		const memberDenied = await request("/api/admin/users", {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(memberDenied.status, 403);

		const users = await request("/api/admin/users", { headers: adminAuth });
		assert.equal(users.status, 200, await users.clone().text());
		const userRows = (
			await users.json<{
				data: Array<{ id: string; email: string; status: string }>;
			}>()
		).data;
		const member = userRows.find((user) => user.email === MEMBER_EMAIL);
		assert.ok(member);
		const pushRelayStatus = await request("/api/admin/push-relay", {
			headers: adminAuth,
		});
		assert.equal(
			pushRelayStatus.status,
			200,
			await pushRelayStatus.clone().text(),
		);
		assert.deepEqual(await pushRelayStatus.json(), {
			enabled: false,
			region: "US",
			installationIdConfigured: false,
			installationKeyConfigured: false,
			reason: "missing_credentials",
			object: "pushRelayStatus",
		});

		const wrongPassword = await request("/api/admin/invites", {
			method: "POST",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({ masterPasswordHash: "wrong", expiresInHours: 24 }),
		});
		assert.equal(wrongPassword.status, 400);

		const wrongPolicyPassword = await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: "wrong",
				signupsAllowed: false,
				invitationsAllowed: true,
			}),
		});
		assert.equal(wrongPolicyPassword.status, 400);
		const registrationPolicyBefore = await context.database
			.prepare("SELECT value FROM config WHERE key = 'registration.policy.v1'")
			.first<{ value: string }>();
		await context.database
			.prepare(`
				CREATE TRIGGER test_fail_atomic_registration_policy_audit
				BEFORE INSERT ON audit_logs
				WHEN NEW.action = 'admin.registration.settings'
				BEGIN
					SELECT RAISE(ABORT, 'simulated audit outage');
				END
			`)
			.run();
		try {
			const failedPolicy = await request("/api/admin/registration", {
				method: "PUT",
				headers: { ...adminAuth, "content-type": "application/json" },
				body: JSON.stringify({
					masterPasswordHash: MASTER_PASSWORD_HASH,
					signupsAllowed: true,
					invitationsAllowed: false,
				}),
			});
			assert.equal(failedPolicy.status, 500);
			assert.deepEqual(
				await context.database
					.prepare(
						"SELECT value FROM config WHERE key = 'registration.policy.v1'",
					)
					.first<{ value: string }>(),
				registrationPolicyBefore,
			);
		} finally {
			await context.database
				.prepare(
					"DROP TRIGGER IF EXISTS test_fail_atomic_registration_policy_audit",
				)
				.run();
		}
		const savedPolicy = await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				signupsAllowed: false,
				invitationsAllowed: true,
			}),
		});
		assert.equal(savedPolicy.status, 200, await savedPolicy.clone().text());
		assert.deepEqual(await savedPolicy.json(), {
			signupsAllowed: false,
			invitationsAllowed: true,
			object: "registrationPolicy",
		});

		const created = await request("/api/admin/invites", {
			method: "POST",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				email: "invited-api-test@example.com",
				expiresInHours: 24,
			}),
		});
		assert.equal(created.status, 201, await created.clone().text());
		const invite = await created.json<{
			code: string;
			email: string;
			status: string;
			inviteLink: string;
		}>();
		assert.equal(invite.status, "active");
		assert.equal(invite.email, "invited-api-test@example.com");
		assert.match(
			invite.inviteLink,
			new RegExp(`/register\\?invite=${invite.code}$`),
		);
		const storedInvite = await context.database
			.prepare("SELECT code, code_encrypted FROM invites WHERE code = ?")
			.bind(await hashCredential(invite.code))
			.first<{ code: string; code_encrypted: string }>();
		assert.ok(storedInvite);
		assert.notEqual(storedInvite.code, invite.code);
		assert.doesNotMatch(storedInvite.code_encrypted, new RegExp(invite.code));

		await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				signupsAllowed: false,
				invitationsAllowed: false,
			}),
		});
		const disabledInvite = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "disabled-invite@example.com",
				masterPasswordHash: MASTER_PASSWORD_HASH,
				key: "encrypted-key",
				kdf: 0,
				kdfIterations: 600_000,
				inviteCode: invite.code,
			}),
		});
		assert.equal(disabledInvite.status, 400);
		await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				signupsAllowed: false,
				invitationsAllowed: true,
			}),
		});
		const invitedPayload = (email: string) => ({
			email,
			name: "Invited Test",
			masterPasswordHash: MASTER_PASSWORD_HASH,
			key: "encrypted-invited-key",
			kdf: 0,
			kdfIterations: 600_000,
			inviteCode: invite.code,
		});
		const wrongEmail = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(invitedPayload("invite-race@example.com")),
		});
		assert.equal(wrongEmail.status, 400);
		assert.equal(
			(await wrongEmail.json<{ message: string }>()).message,
			"Invite does not match this email address",
		);
		const competingRegistrations = await Promise.all([
			request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(invitedPayload("invited-api-test@example.com")),
			}),
			request("/api/accounts/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(invitedPayload("INVITED-API-TEST@EXAMPLE.COM")),
			}),
		]);
		const competingStatuses = competingRegistrations.map(
			(response) => response.status,
		);
		assert.equal(
			competingStatuses.filter((status) => status === 204).length,
			1,
		);
		assert.ok(
			competingStatuses.every((status) => [204, 400, 409].includes(status)),
		);
		const invitedUser = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind("invited-api-test@example.com")
			.first<{ id: string }>();
		assert.ok(invitedUser);
		assert.deepEqual(
			await context.database
				.prepare("SELECT status, used_by FROM invites WHERE code = ?")
				.bind(await hashCredential(invite.code))
				.first<{ status: string; used_by: string | null }>(),
			{ status: "used", used_by: invitedUser.id },
		);
		assert.equal(
			await context.database
				.prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?")
				.bind("invited-api-test@example.com")
				.first<{ count: number }>()
				.then((row) => Number(row?.count ?? 0)),
			1,
		);

		const replayInvite = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "invite-replay@example.com",
				masterPasswordHash: MASTER_PASSWORD_HASH,
				key: "key",
				kdf: 0,
				kdfIterations: 600_000,
				inviteCode: invite.code,
			}),
		});
		assert.equal(replayInvite.status, 400);
		await request("/api/admin/registration", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				masterPasswordHash: MASTER_PASSWORD_HASH,
				signupsAllowed: true,
				invitationsAllowed: true,
			}),
		});

		const statusAuditCountBefore = await context.database
			.prepare(
				"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'admin.user.status' AND target_id = ?",
			)
			.bind(member.id)
			.first<{ count: number }>()
			.then((row) => Number(row?.count ?? 0));
		const banRequest = () =>
			request(`/api/admin/users/${member.id}/status`, {
				method: "PUT",
				headers: { ...adminAuth, "content-type": "application/json" },
				body: JSON.stringify({
					status: "banned",
					masterPasswordHash: MASTER_PASSWORD_HASH,
				}),
			});
		await context.database
			.prepare(`
				CREATE TRIGGER test_fail_atomic_admin_status_audit
				BEFORE INSERT ON audit_logs
				WHEN NEW.action = 'admin.user.status'
				BEGIN
					SELECT RAISE(ABORT, 'simulated audit outage');
				END
			`)
			.run();
		try {
			const failedBan = await banRequest();
			assert.equal(failedBan.status, 500);
			assert.equal(
				await context.database
					.prepare("SELECT status FROM users WHERE id = ?")
					.bind(member.id)
					.first<{ status: string }>()
					.then((row) => row?.status),
				"active",
			);
			assert.equal(
				(
					await request("/api/accounts/profile", {
						headers: {
							authorization: `Bearer ${context.memberAccessToken}`,
						},
					})
				).status,
				200,
			);
		} finally {
			await context.database
				.prepare("DROP TRIGGER IF EXISTS test_fail_atomic_admin_status_audit")
				.run();
		}
		const banned = await banRequest();
		assert.equal(banned.status, 200, await banned.clone().text());
		const duplicateBan = await banRequest();
		assert.equal(duplicateBan.status, 200, await duplicateBan.clone().text());
		assert.equal(
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'admin.user.status' AND target_id = ?",
				)
				.bind(member.id)
				.first<{ count: number }>()
				.then((row) => Number(row?.count ?? 0)),
			statusAuditCountBefore + 1,
		);
		assert.equal(
			(
				await request("/api/accounts/profile", {
					headers: { authorization: `Bearer ${context.memberAccessToken}` },
				})
			).status,
			401,
		);
		const restored = await request(`/api/admin/users/${member.id}/status`, {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({
				status: "active",
				masterPasswordHash: MASTER_PASSWORD_HASH,
			}),
		});
		assert.equal(restored.status, 200, await restored.clone().text());
		const relogin = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "password",
				username: MEMBER_EMAIL,
				password: MASTER_PASSWORD_HASH,
				deviceIdentifier: "member-test-device-restored",
				deviceName: "Restored Member Device",
				deviceType: "0",
			}),
		});
		assert.equal(relogin.status, 200, await relogin.clone().text());
		context.memberAccessToken = (
			await relogin.json<{ access_token: string }>()
		).access_token;

		const logs = await request("/api/admin/logs?category=admin&limit=20", {
			headers: adminAuth,
		});
		assert.equal(logs.status, 200, await logs.clone().text());
		const entries = (
			await logs.json<{
				data: Array<{ action: string; metadata: Record<string, unknown> }>;
			}>()
		).data;
		assert.ok(entries.some((entry) => entry.action === "admin.invite.create"));
		assert.ok(entries.some((entry) => entry.action === "admin.user.status"));
		assert.ok(
			entries.every(
				(entry) =>
					!JSON.stringify(entry.metadata).match(
						/masterPasswordHash|test-secret|encrypted-/i,
					),
			),
		);

		const defaultSettings = await request("/api/admin/logs/settings", {
			headers: adminAuth,
		});
		assert.equal(defaultSettings.status, 200);
		assert.deepEqual(
			await defaultSettings
				.json<any>()
				.then((value) => [value.retentionDays, value.maxEntries]),
			[null, null],
		);
		assert.equal(
			(
				await request("/api/admin/logs", {
					method: "DELETE",
					headers: adminAuth,
				})
			).status,
			404,
		);
		assert.equal(
			(
				await request("/api/admin/logs/settings", {
					headers: { authorization: `Bearer ${context.memberAccessToken}` },
				})
			).status,
			403,
		);
		const updatedSettings = await request("/api/admin/logs/settings", {
			method: "PUT",
			headers: { ...adminAuth, "content-type": "application/json" },
			body: JSON.stringify({ retentionDays: null, maxEntries: 100 }),
		});
		assert.equal(
			updatedSettings.status,
			200,
			await updatedSettings.clone().text(),
		);
		assert.deepEqual(
			await updatedSettings
				.json<any>()
				.then((value) => [value.retentionDays, value.maxEntries]),
			[null, 100],
		);
	});

	test("resource middleware prevents cross-user cipher access", async () => {
		const response = await request(`/api/ciphers/${context.cipherId}`, {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(response.status, 404);
	});

	test("retains organization tombstones across scheduled maintenance", async () => {
		const owner = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		assert.ok(owner);
		const orgId = crypto.randomUUID();
		const memberId = crypto.randomUUID();
		const timestamp = Math.floor(Date.now() / 1000);
		await context.database.batch([
			context.database
				.prepare(
					"INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)",
				)
				.bind(orgId, "encrypted-delete-org", timestamp, timestamp),
			context.database
				.prepare(
					"INSERT INTO org_members (id,org_id,user_id,email,key,role,status,access_all,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					memberId,
					orgId,
					owner.id,
					EMAIL,
					"encrypted-org-key",
					"owner",
					"confirmed",
					1,
					timestamp,
					timestamp,
				),
		]);
		const updateRevisionBefore = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(owner.id)
			.first<{ revision_date: number }>();
		assert.ok(updateRevisionBefore);
		const update = (index: number) =>
			request(`/api/organizations/${orgId}`, {
				method: "PUT",
				headers: {
					authorization: `Bearer ${context.accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ name: `encrypted-org-update-${index}` }),
			});
		const updates = await Promise.all(
			Array.from({ length: 8 }, (_, index) => update(index)),
		);
		assert.equal(
			updates.filter((response) => response.status === 200).length,
			1,
		);
		assert.equal(
			updates.filter((response) => response.status === 409).length,
			7,
		);
		assert.equal(
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(owner.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			updateRevisionBefore.revision_date + 1,
		);

		const revisionBefore = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(owner.id)
			.first<{ revision_date: number }>();
		assert.ok(revisionBefore);
		const remove = () =>
			request(`/api/organizations/${orgId}`, {
				method: "DELETE",
				headers: {
					authorization: `Bearer ${context.accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ masterPasswordHash: MASTER_PASSWORD_HASH }),
			});
		const deleted = await Promise.all([remove(), remove()]);
		assert.ok(deleted.some((response) => response.status === 204));
		assert.ok(
			deleted.every((response) => [204, 404].includes(response.status)),
		);
		assert.equal(
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(owner.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			revisionBefore.revision_date + 1,
		);
		assert.equal(
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'organization.delete' AND target_id = ?",
				)
				.bind(orgId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
		assert.ok(
			await context.database
				.prepare(
					"SELECT 1 FROM organizations WHERE id = ? AND deletion_requested_at IS NOT NULL",
				)
				.bind(orgId)
				.first(),
		);
		assert.equal(
			(
				await request(`/api/organizations/${orgId}`, {
					headers: { authorization: `Bearer ${context.accessToken}` },
				})
			).status,
			404,
		);

		const { db } = await createDatabase(context.database);
		try {
			const result = await runMaintenance(db, context.bindings, timestamp + 1);
			assert.equal(result.purgedOrganizations, 0);
		} finally {
			await db.destroy();
		}
		assert.ok(
			await context.database
				.prepare("SELECT 1 FROM organizations WHERE id = ?")
				.bind(orgId)
				.first(),
		);
		assert.equal(
			await context.database
				.prepare(
					"SELECT 1 FROM audit_logs WHERE action = 'organization.purged' AND target_id = ?",
				)
				.bind(orgId)
				.first(),
			null,
		);
		// Test isolation: production maintenance never performs this physical delete.
		await context.database
			.prepare("DELETE FROM organizations WHERE id = ?")
			.bind(orgId)
			.run();
	});

	test("admits only one concurrent organization member invitation", async () => {
		const targetEmail = `concurrent-invite-${crypto.randomUUID()}@example.com`;
		const registered = await request("/api/accounts/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: targetEmail,
				name: "Concurrent Invite Target",
				masterPasswordHash: MASTER_PASSWORD_HASH,
				key: "encrypted-invite-target-key",
				kdf: 0,
				kdfIterations: 600_000,
			}),
		});
		assert.equal(registered.status, 204, await registered.clone().text());
		const owner = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		const target = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(targetEmail)
			.first<{ id: string }>();
		assert.ok(owner?.id && target?.id);
		await context.database
			.prepare("UPDATE users SET public_key = ? WHERE id = ?")
			.bind("member-invitation-public-key", target.id)
			.run();
		const timestamp = Math.floor(Date.now() / 1000);
		const orgId = crypto.randomUUID();
		const ownerMemberId = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		await context.database.batch([
			context.database
				.prepare(
					"INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)",
				)
				.bind(orgId, "Concurrent invitation org", timestamp, timestamp),
			context.database
				.prepare(
					"INSERT INTO org_members (id,org_id,user_id,email,role,status,access_all,key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					ownerMemberId,
					orgId,
					owner.id,
					EMAIL,
					"owner",
					"confirmed",
					1,
					"owner-key",
					timestamp,
					timestamp,
				),
			context.database
				.prepare(
					"INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
				)
				.bind(
					collectionId,
					orgId,
					"invitation-collection",
					timestamp,
					timestamp,
				),
		]);
		const ownerRevision = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(owner.id)
			.first<{ revision_date: number }>();
		const targetRevision = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(target.id)
			.first<{ revision_date: number }>();
		assert.ok(ownerRevision && targetRevision);
		const invite = () =>
			request(`/api/organizations/${orgId}/members`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${context.accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					email: targetEmail,
					role: "member",
					accessAll: false,
					key: "encrypted-member-key",
					collections: [
						{
							id: collectionId,
							readOnly: true,
							hidePasswords: false,
						},
					],
				}),
			});
		const responses = await Promise.all([
			invite(),
			invite(),
			invite(),
			invite(),
		]);
		assert.equal(
			responses.filter((response) => response.status === 201).length,
			1,
		);
		assert.equal(
			responses.filter((response) => response.status === 409).length,
			3,
		);
		assert.equal(
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM org_members WHERE org_id = ? AND email = ?",
				)
				.bind(orgId, targetEmail)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);
		assert.equal(
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(owner.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			ownerRevision.revision_date + 1,
		);
		assert.equal(
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(target.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			targetRevision.revision_date + 1,
		);
		await context.database
			.prepare("DELETE FROM organizations WHERE id = ?")
			.bind(orgId)
			.run();
		await context.database
			.prepare("DELETE FROM users WHERE id = ?")
			.bind(target.id)
			.run();
	});

	test("enforces organization collection visibility and read-only writes", async () => {
		const owner = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(EMAIL)
			.first<{ id: string }>();
		const restrictedUser = await context.database
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(MEMBER_EMAIL)
			.first<{ id: string }>();
		assert.ok(owner?.id && restrictedUser?.id);
		const timestamp = Math.floor(Date.now() / 1000);
		const orgId = crypto.randomUUID();
		const ownerMemberId = crypto.randomUUID();
		const restrictedMemberId = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		const otherOrgId = crypto.randomUUID();
		const otherCollectionId = crypto.randomUUID();
		await context.database.batch([
			context.database
				.prepare(
					"INSERT INTO organizations (id,name,public_key,private_key,created_at,updated_at) VALUES (?,?,?,?,?,?)",
				)
				.bind(
					orgId,
					"Test organization",
					"public",
					"private",
					timestamp,
					timestamp,
				),
			context.database
				.prepare(
					"INSERT INTO org_members (id,org_id,user_id,email,role,status,access_all,key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					ownerMemberId,
					orgId,
					owner.id,
					EMAIL,
					"owner",
					"confirmed",
					1,
					"owner-key",
					timestamp,
					timestamp,
				),
			context.database
				.prepare(
					"INSERT INTO org_members (id,org_id,user_id,email,role,status,access_all,key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					restrictedMemberId,
					orgId,
					restrictedUser.id,
					MEMBER_EMAIL,
					"member",
					"confirmed",
					0,
					"member-key",
					timestamp,
					timestamp,
				),
			context.database
				.prepare(
					"INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
				)
				.bind(
					collectionId,
					orgId,
					"encrypted-collection",
					timestamp,
					timestamp,
				),
			context.database
				.prepare(
					"INSERT INTO collection_members (collection_id,org_member_id,read_only,hide_passwords) VALUES (?,?,1,0)",
				)
				.bind(collectionId, restrictedMemberId),
			context.database
				.prepare(
					"INSERT INTO organizations (id,name,created_at,updated_at) VALUES (?,?,?,?)",
				)
				.bind(otherOrgId, "Other organization", timestamp, timestamp),
			context.database
				.prepare(
					"INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
				)
				.bind(
					otherCollectionId,
					otherOrgId,
					"other-organization-collection",
					timestamp,
					timestamp,
				),
		]);
		const restrictedCollections = await request("/api/collections", {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(
			restrictedCollections.status,
			200,
			await restrictedCollections.clone().text(),
		);
		assert.deepEqual(
			(
				await restrictedCollections.json<{
					data: Array<{ id: string; readOnly: boolean }>;
				}>()
			).data.map((collection) => [collection.id, collection.readOnly]),
			[[collectionId, true]],
		);
		const ownerCollections = await request("/api/collections", {
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.deepEqual(
			(
				await ownerCollections.json<{
					data: Array<{ id: string; readOnly: boolean }>;
				}>()
			).data.map((collection) => [collection.id, collection.readOnly]),
			[[collectionId, false]],
		);
		assert.equal(
			(
				await request(`/api/organizations/${orgId}`, {
					method: "POST",
					headers: {
						authorization: `Bearer ${context.accessToken}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({ name: "Renamed organization" }),
				})
			).status,
			200,
		);

		const payload = {
			type: 1,
			name: "encrypted-name",
			notes: null,
			favorite: false,
			folderId: null,
			organizationId: orgId,
			collectionIds: [collectionId],
			key: "encrypted-item-key",
			login: { username: "encrypted-user", password: "encrypted-password" },
		};
		const crossOrganizationWrite = await request("/api/ciphers", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				...payload,
				name: "cross-organization-cipher",
				collectionIds: [otherCollectionId],
			}),
		});
		assert.equal(crossOrganizationWrite.status, 404);
		const created = await request("/api/ciphers", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		assert.equal(created.status, 200, await created.clone().text());
		const cipher = await created.json<{
			id: string;
			organizationId: string;
			collectionIds: string[];
		}>();
		assert.equal(cipher.organizationId, orgId);
		assert.deepEqual(cipher.collectionIds, [collectionId]);
		const stored = await context.database
			.prepare("SELECT user_id, org_id, folder_id FROM ciphers WHERE id = ?")
			.bind(cipher.id)
			.first<{
				user_id: string | null;
				org_id: string;
				folder_id: string | null;
			}>();
		assert.deepEqual(stored, { user_id: null, org_id: orgId, folder_id: null });

		const favorited = await request(`/api/ciphers/${cipher.id}`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ...payload, favorite: true }),
		});
		assert.equal(favorited.status, 200, await favorited.clone().text());
		assert.equal(
			(await favorited.json<{ favorite: boolean }>()).favorite,
			true,
		);
		const restrictedView = await request(`/api/ciphers/${cipher.id}`, {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(
			(await restrictedView.json<{ favorite: boolean }>()).favorite,
			false,
			"organization cipher favorites must be isolated per member",
		);
		const archived = await request(`/api/ciphers/${cipher.id}/archive`, {
			method: "PUT",
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.ok(
			(await archived.json<{ archivedDate: string | null }>()).archivedDate,
		);
		const restrictedAfterArchive = await request(`/api/ciphers/${cipher.id}`, {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(
			(await restrictedAfterArchive.json<{ archivedDate: string | null }>())
				.archivedDate,
			null,
			"organization cipher archives must be isolated per member",
		);
		const unarchived = await request(`/api/ciphers/${cipher.id}/unarchive`, {
			method: "PUT",
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.equal(unarchived.status, 200, await unarchived.clone().text());
		await context.database
			.prepare(
				"UPDATE collection_members SET read_only = 0 WHERE collection_id = ? AND org_member_id = ?",
			)
			.bind(collectionId, restrictedMemberId)
			.run();
		const memberArchived = await request("/api/ciphers/archive", {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.memberAccessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ids: [cipher.id] }),
		});
		assert.equal(
			memberArchived.status,
			200,
			await memberArchived.clone().text(),
		);
		const ownerAfterMemberArchive = await request(`/api/ciphers/${cipher.id}`, {
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.equal(
			(await ownerAfterMemberArchive.json<{ archivedDate: string | null }>())
				.archivedDate,
			null,
		);
		await request("/api/ciphers/unarchive", {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.memberAccessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ids: [cipher.id] }),
		});
		await context.database
			.prepare(
				"UPDATE collection_members SET read_only = 1 WHERE collection_id = ? AND org_member_id = ?",
			)
			.bind(collectionId, restrictedMemberId)
			.run();

		const secondCollectionId = crypto.randomUUID();
		await context.database.batch([
			context.database
				.prepare(
					"INSERT INTO collections (id,org_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
				)
				.bind(
					secondCollectionId,
					orgId,
					"second-encrypted-collection",
					timestamp,
					timestamp,
				),
			context.database
				.prepare(
					"INSERT INTO collection_members (collection_id,org_member_id,read_only,hide_passwords) VALUES (?,?,1,0)",
				)
				.bind(secondCollectionId, restrictedMemberId),
			context.database
				.prepare(
					"INSERT INTO cipher_collections (cipher_id,collection_id) VALUES (?,?)",
				)
				.bind(cipher.id, secondCollectionId),
		]);
		const restrictedSync = await request("/api/sync", {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(
			restrictedSync.status,
			200,
			await restrictedSync.clone().text(),
		);
		const restrictedSyncBody = await restrictedSync.json<{
			ciphers: Array<{ id: string; collectionIds: string[] }>;
			collections: Array<{
				id: string;
				externalId: string | null;
				type: number;
				defaultUserCollectionEmail: string | null;
				manage: boolean;
				object: string;
			}>;
		}>();
		const syncedCipherRows = restrictedSyncBody.ciphers.filter(
			(item) => item.id === cipher.id,
		);
		assert.equal(syncedCipherRows.length, 1);
		assert.deepEqual(
			new Set(syncedCipherRows[0].collectionIds),
			new Set([collectionId, secondCollectionId]),
		);
		assert.deepEqual(
			restrictedSyncBody.collections
				.filter((collection) => collection.id === secondCollectionId)
				.map((collection) => ({
					externalId: collection.externalId,
					type: collection.type,
					defaultUserCollectionEmail: collection.defaultUserCollectionEmail,
					manage: collection.manage,
					object: collection.object,
				})),
			[
				{
					externalId: null,
					type: 0,
					defaultUserCollectionEmail: null,
					manage: false,
					object: "collectionDetails",
				},
			],
		);
		await context.database.batch([
			context.database
				.prepare(
					"DELETE FROM cipher_collections WHERE cipher_id = ? AND collection_id = ?",
				)
				.bind(cipher.id, secondCollectionId),
			context.database
				.prepare("DELETE FROM collections WHERE id = ?")
				.bind(secondCollectionId),
		]);

		const visible = await request(`/api/ciphers/${cipher.id}`, {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(visible.status, 200, await visible.clone().text());
		assert.deepEqual(
			await visible
				.json<{
					edit: boolean;
					viewPassword: boolean;
					permissions: { delete: boolean; restore: boolean };
				}>()
				.then((value) => [
					value.edit,
					value.viewPassword,
					value.permissions.delete,
					value.permissions.restore,
				]),
			[false, true, false, false],
		);
		const deniedWrite = await request(`/api/ciphers/${cipher.id}`, {
			method: "PUT",
			headers: {
				authorization: `Bearer ${context.memberAccessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		assert.equal(deniedWrite.status, 403);
		await context.database
			.prepare("UPDATE org_members SET role = 'manager' WHERE id = ?")
			.bind(restrictedMemberId)
			.run();
		const beforeCollectionRevision = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(restrictedUser.id)
			.first<{ revision_date: number }>();
		assert.ok(beforeCollectionRevision);
		const updateCollection = (index: number) =>
			request(`/api/organizations/${orgId}/collections/${collectionId}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${context.memberAccessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ name: `encrypted-renamed-collection-${index}` }),
			});
		const collectionUpdates = await Promise.all(
			Array.from({ length: 8 }, (_, index) => updateCollection(index)),
		);
		assert.equal(
			collectionUpdates.filter((response) => response.status === 200).length,
			1,
		);
		assert.equal(
			collectionUpdates.filter((response) => response.status === 409).length,
			7,
		);
		assert.equal(
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(restrictedUser.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			beforeCollectionRevision.revision_date + 1,
		);
		const protectedDelete = await request(
			`/api/organizations/${orgId}/collections/${collectionId}`,
			{
				method: "DELETE",
				headers: {
					authorization: `Bearer ${context.memberAccessToken}`,
				},
			},
		);
		assert.equal(
			protectedDelete.status,
			409,
			await protectedDelete.clone().text(),
		);
		assert.ok(
			await context.database
				.prepare("SELECT 1 FROM collections WHERE id = ?")
				.bind(collectionId)
				.first(),
		);
		const escalation = await request(`/api/organizations/${orgId}/members`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.memberAccessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				email: "nobody@example.com",
				role: "admin",
				accessAll: true,
				collections: [],
				key: "encrypted-key",
			}),
		});
		assert.equal(escalation.status, 403);

		await context.database
			.prepare(
				"DELETE FROM collection_members WHERE collection_id = ? AND org_member_id = ?",
			)
			.bind(collectionId, restrictedMemberId)
			.run();
		assert.deepEqual(
			(
				await (
					await request("/api/collections", {
						headers: { authorization: `Bearer ${context.memberAccessToken}` },
					})
				).json<{ data: unknown[] }>()
			).data,
			[],
		);
		const hidden = await request(`/api/ciphers/${cipher.id}`, {
			headers: { authorization: `Bearer ${context.memberAccessToken}` },
		});
		assert.equal(hidden.status, 404);

		// Instance backups must preserve the complete organization graph while
		// excluding machine credentials such as API keys.
		const apiKeyResponse = await request("/api/accounts/rotate-api-key", {
			method: "POST",
			headers: { authorization: `Bearer ${context.accessToken}` },
		});
		assert.equal(
			apiKeyResponse.status,
			200,
			await apiKeyResponse.clone().text(),
		);
		const apiKey = (await apiKeyResponse.json<{ apiKey: string }>()).apiKey;
		const persistedApiKey = await context.database
			.prepare("SELECT api_key_hash, api_key_encrypted FROM users WHERE id = ?")
			.bind(owner.id)
			.first<{ api_key_hash: string; api_key_encrypted: string }>();
		assert.equal(persistedApiKey?.api_key_hash, await hashCredential(apiKey));
		assert.doesNotMatch(
			persistedApiKey?.api_key_encrypted ?? "",
			new RegExp(apiKey),
		);
		const apiSession = await request("/identity/connect/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: `user.${owner.id}`,
				client_secret: apiKey,
			}),
		});
		assert.equal(apiSession.status, 200, await apiSession.clone().text());
		const backupResponse = await request("/api/admin/backup/export", {
			method: "POST",
			headers: {
				authorization: `Bearer ${context.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ includeAttachments: false }),
		});
		assert.equal(
			backupResponse.status,
			200,
			await backupResponse.clone().text(),
		);
		context.organizationBackup = new Uint8Array(
			await backupResponse.arrayBuffer(),
		);
		const backupDb = JSON.parse(
			new TextDecoder().decode(
				unzipSync(context.organizationBackup)["db.json"],
			),
		) as {
			users: Array<Record<string, unknown>>;
			organizations: Array<{ id: string }>;
			collections: Array<{ id: string }>;
			cipher_collections: Array<{ cipher_id: string; collection_id: string }>;
		};
		assert.equal(
			backupDb.users.some(
				(row) => "api_key_hash" in row || "api_key_encrypted" in row,
			),
			false,
		);
		assert.ok(backupDb.organizations.some((row) => row.id === orgId));
		assert.ok(backupDb.collections.some((row) => row.id === collectionId));
		assert.ok(
			backupDb.cipher_collections.some(
				(row) =>
					row.cipher_id === cipher.id && row.collection_id === collectionId,
			),
		);
		context.backedUpOrganizationId = orgId;
		context.backedUpCollectionId = collectionId;

		const beforeMemberRevision = await context.database
			.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
			.bind(restrictedUser.id)
			.first<{ revision_date: number }>();
		assert.ok(beforeMemberRevision);
		const updateMemberPermissions = (index: number) =>
			request(`/api/organizations/${orgId}/members/${restrictedMemberId}`, {
				method: "PUT",
				headers: {
					authorization: `Bearer ${context.accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					role: "member",
					accessAll: false,
					collections: [
						{
							id: collectionId,
							readOnly: true,
							hidePasswords: index % 2 === 0,
						},
					],
				}),
			});
		const memberUpdates = await Promise.all(
			Array.from({ length: 8 }, (_, index) => updateMemberPermissions(index)),
		);
		assert.equal(
			memberUpdates.filter((response) => response.status === 200).length,
			1,
		);
		assert.equal(
			memberUpdates.filter((response) => response.status === 409).length,
			7,
		);
		assert.equal(
			await context.database
				.prepare("SELECT revision_date FROM user_revisions WHERE user_id = ?")
				.bind(restrictedUser.id)
				.first<{ revision_date: number }>()
				.then((row) => row?.revision_date),
			beforeMemberRevision.revision_date + 1,
		);
		assert.equal(
			await context.database
				.prepare(
					"SELECT COUNT(*) AS count FROM collection_members WHERE org_member_id = ?",
				)
				.bind(restrictedMemberId)
				.first<{ count: number }>()
				.then((row) => Number(row?.count)),
			1,
		);

		const removed = await request(
			`/api/organizations/${orgId}/members/${restrictedMemberId}`,
			{
				method: "DELETE",
				headers: { authorization: `Bearer ${context.accessToken}` },
			},
		);
		assert.equal(removed.status, 204, await removed.clone().text());
		assert.equal(
			(
				await request(`/api/organizations/${orgId}`, {
					headers: { authorization: `Bearer ${context.memberAccessToken}` },
				})
			).status,
			404,
		);
	});
}
