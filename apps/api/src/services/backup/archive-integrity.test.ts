import { describe, expect, it } from "vitest";
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
});
