import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { assertBackupArchiveIntegrity } from "./archive";
import {
	buildBackupFileNameInTimeZone,
	extractBackupFileChecksumPrefix,
	getBackupArchiveChecksumPrefix,
	inspectBackupArchiveFileNameChecksum,
	verifyBackupArchiveFileNameChecksum,
} from "./archive-integrity";

const bytes = new TextEncoder().encode("edgewarden backup");

describe("backup archive file names", () => {
	it("uses the configured time zone and optional checksum", () => {
		const date = new Date("2026-08-12T03:04:05.000Z");
		expect(buildBackupFileNameInTimeZone(date)).toBe(
			"edgewarden_backup_20260812_030405.zip",
		);
		expect(buildBackupFileNameInTimeZone(date, "abc12", "Asia/Hong_Kong")).toBe(
			"edgewarden_backup_20260812_110405_abc12.zip",
		);
	});

	it("only extracts a trailing five-character hexadecimal checksum", () => {
		expect(extractBackupFileChecksumPrefix("backup_A0b1C.zip")).toBe("a0b1c");
		expect(extractBackupFileChecksumPrefix("backup_abc1.zip")).toBeNull();
		expect(extractBackupFileChecksumPrefix("backup_abc1z.zip")).toBeNull();
	});
});

describe("backup archive integrity", () => {
	it("matches the checksum prefix encoded in the file name", async () => {
		const prefix = await getBackupArchiveChecksumPrefix(bytes);
		const fileName = `edgewarden_backup_20260812_030405_${prefix}.zip`;

		expect(await verifyBackupArchiveFileNameChecksum(bytes, fileName)).toBe(
			true,
		);
		expect(await inspectBackupArchiveFileNameChecksum(bytes, fileName)).toEqual(
			{
				hasChecksumPrefix: true,
				expectedPrefix: prefix,
				actualPrefix: prefix,
				matches: true,
			},
		);
	});

	it("rejects a mismatched checksum but accepts legacy names", async () => {
		expect(
			await verifyBackupArchiveFileNameChecksum(bytes, "backup_00000.zip"),
		).toBe(false);
		expect(
			await verifyBackupArchiveFileNameChecksum(bytes, "legacy-backup.zip"),
		).toBe(true);
	});

	it("rejects a checksum-valid archive with missing required blobs", async () => {
		const encoder = new TextEncoder();
		const manifest = {
			formatVersion: 3,
			exportedAt: "2026-08-12T03:04:05.000Z",
			appVersion: "test",
			storageKind: "r2",
			tableCounts: {
				config: 0,
				users: 0,
				domain_settings: 0,
				user_revisions: 0,
				folders: 0,
				ciphers: 0,
				attachments: 1,
			},
			includes: { attachments: true, fileSends: true },
			blobSummary: {
				attachmentFiles: 1,
				sendFiles: 0,
				totalBytes: 1,
				largestObjectBytes: 1,
			},
		};
		const db = {
			config: [],
			users: [],
			domain_settings: [],
			user_revisions: [],
			folders: [],
			ciphers: [],
			attachments: [{ id: "attachment-id", cipher_id: "cipher-id", size: 1 }],
		};
		const incomplete = zipSync({
			"manifest.json": encoder.encode(JSON.stringify(manifest)),
			"db.json": encoder.encode(JSON.stringify(db)),
		});
		const prefix = await getBackupArchiveChecksumPrefix(incomplete);

		await expect(
			assertBackupArchiveIntegrity(
				incomplete,
				`edgewarden_backup_20260812_030405_${prefix}.zip`,
				incomplete.byteLength,
			),
		).rejects.toThrow(
			"Backup archive is missing required file: attachments/cipher-id/attachment-id.bin",
		);
	});

	it("rejects a syntactically valid database payload with truncated rows", async () => {
		const encoder = new TextEncoder();
		const archive = zipSync({
			"manifest.json": encoder.encode(
				JSON.stringify({
					formatVersion: 3,
					exportedAt: "2026-08-12T03:04:05.000Z",
					appVersion: "test",
					storageKind: null,
					tableCounts: { users: 1 },
					includes: { attachments: false, fileSends: false },
					blobSummary: {
						attachmentFiles: 0,
						sendFiles: 0,
						totalBytes: 0,
						largestObjectBytes: 0,
					},
				}),
			),
			"db.json": encoder.encode(JSON.stringify({ users: [] })),
		});
		const prefix = await getBackupArchiveChecksumPrefix(archive);

		await expect(
			assertBackupArchiveIntegrity(
				archive,
				`edgewarden_backup_20260812_030405_${prefix}.zip`,
			),
		).rejects.toThrow(
			"Backup archive table count mismatch for users: expected 1, received 0",
		);
	});
});
