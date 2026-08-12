import assert from "node:assert";
import { sign } from "hono/jwt";
import { describe, test } from "vitest";
import {
	createAttachmentUploadToken,
	createJWT,
	createRealtimeTicket,
	createRefreshToken,
	createSendFileDownloadToken,
	deriveJwtPurposeSecret,
	hashRefreshToken,
	verifyAttachmentUploadToken,
	verifyJWT,
	verifyRealtimeTicket,
	verifySendFileDownloadToken,
} from "./jwt";

describe("jwt utils", () => {
	const secret = "a-very-long-secret-key-that-is-at-least-32-chars-long";

	describe("refreshToken", () => {
		test("createRefreshToken returns url-safe base64 string", () => {
			const token = createRefreshToken();
			assert.strictEqual(typeof token, "string");
			assert.ok(token.length > 0);
			assert.ok(!token.includes("+"));
			assert.ok(!token.includes("/"));
			assert.ok(!token.includes("="));
		});

		test("hashRefreshToken returns SHA-256 hex hash", async () => {
			const token = "hello-world";
			// SHA-256 hash of "hello-world"
			const expected =
				"afa27b44d43b02a9fea41d13cedc2e4016cfcf87c5dbf990e593669aa8ce286d";
			const hashed = await hashRefreshToken(token);
			assert.strictEqual(hashed, expected);
		});
	});

	describe("createJWT / verifyJWT", () => {
		test("derives independent signing keys for specialized token purposes", async () => {
			const realtime = await deriveJwtPurposeSecret(secret, "realtime");
			const attachment = await deriveJwtPurposeSecret(
				secret,
				"attachment-upload",
			);
			assert.notEqual(realtime, secret);
			assert.notEqual(realtime, attachment);
		});

		test("can sign and verify token", async () => {
			const inputPayload = {
				sub: "user-123",
				email: "user@example.com",
				name: "Alice",
				sstamp: "security-stamp",
			};
			const token = await createJWT(inputPayload, secret);
			const verified = await verifyJWT(token, secret);

			assert.ok(verified);
			if (!verified) return;
			assert.strictEqual(verified.sub, "user-123");
			assert.strictEqual(verified.email, "user@example.com");
			assert.strictEqual(verified.name, "Alice");
			assert.strictEqual(verified.sstamp, "security-stamp");
			assert.strictEqual(verified.premium, true);
			assert.strictEqual(verified.typ, "access");
			assert.strictEqual(verified.aud, "edgewarden-api");
		});

		test("rejects a valid realtime ticket as an API access token", async () => {
			const token = await createRealtimeTicket(
				"user-123",
				"security-stamp",
				secret,
			);
			assert.strictEqual(await verifyJWT(token, secret), null);
		});

		test("returns null for invalid signature", async () => {
			const inputPayload = {
				sub: "user-123",
				email: "user@example.com",
				name: "Alice",
				sstamp: "security-stamp",
			};
			const token = await createJWT(inputPayload, secret);
			const verified = await verifyJWT(token, "different-secret-key-goes-here");
			assert.strictEqual(verified, null);
		});

		test("returns null for expired token", async () => {
			const inputPayload = {
				sub: "user-123",
				email: "user@example.com",
				name: "Alice",
				sstamp: "security-stamp",
			};
			// set expiresIn to negative value
			const token = await createJWT(inputPayload, secret, -10);
			const verified = await verifyJWT(token, secret);
			assert.strictEqual(verified, null);
		});
	});

	describe("sendFileDownloadToken", () => {
		test("can sign and verify download token", async () => {
			const token = await createSendFileDownloadToken(
				"send-id",
				"file-id",
				secret,
			);
			const verified = await verifySendFileDownloadToken(token, secret);

			assert.ok(verified);
			if (!verified) return;
			assert.strictEqual(verified.sendId, "send-id");
			assert.strictEqual(verified.fileId, "file-id");
		});

		test("returns null for expired download token", async () => {
			const token = await createSendFileDownloadToken(
				"send-id",
				"file-id",
				secret,
			);
			const verified = await verifySendFileDownloadToken(token, "wrong-secret");
			assert.strictEqual(verified, null);
		});
	});

	describe("attachmentUploadToken", () => {
		test("binds an upload URL to the user, cipher and attachment", async () => {
			const token = await createAttachmentUploadToken(
				"user-id",
				"cipher-id",
				"attachment-id",
				secret,
			);
			const verified = await verifyAttachmentUploadToken(token, secret);
			assert.deepEqual(
				verified && [
					verified.userId,
					verified.cipherId,
					verified.attachmentId,
					verified.typ,
				],
				["user-id", "cipher-id", "attachment-id", "attachment_upload"],
			);
		});

		test("rejects a token signed by another server", async () => {
			const token = await createAttachmentUploadToken(
				"user-id",
				"cipher-id",
				"attachment-id",
				secret,
			);
			assert.strictEqual(
				await verifyAttachmentUploadToken(
					token,
					"another-long-secret-key-that-is-invalid",
				),
				null,
			);
		});
	});

	describe("realtime tickets", () => {
		test("creates a short-lived user and security-stamp bound ticket", async () => {
			const token = await createRealtimeTicket(
				"user-id",
				"security-stamp",
				secret,
			);
			const verified = await verifyRealtimeTicket(token, secret);
			assert.deepEqual(
				verified && [verified.sub, verified.sstamp, verified.typ],
				["user-id", "security-stamp", "realtime"],
			);
			assert.ok(verified && verified.exp <= Math.floor(Date.now() / 1000) + 60);
		});

		test("rejects a realtime ticket signed by another server", async () => {
			const token = await createRealtimeTicket(
				"user-id",
				"security-stamp",
				secret,
			);
			assert.equal(
				await verifyRealtimeTicket(
					token,
					"another-long-secret-key-that-is-invalid",
				),
				null,
			);
		});

		test("rejects correctly signed tickets with invalid claims", async () => {
			const token = await sign(
				{
					sub: "",
					sstamp: "security-stamp",
					typ: "realtime",
					exp: Math.floor(Date.now() / 1000) + 60,
				},
				await deriveJwtPurposeSecret(secret, "realtime"),
			);
			assert.equal(await verifyRealtimeTicket(token, secret), null);
		});
	});
});
