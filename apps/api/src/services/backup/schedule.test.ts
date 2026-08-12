import { describe, expect, it } from "vitest";
import type { BackupDestinationRecord } from "./config";
import {
	getBackupLocalDateKey,
	hasBackupSlotBetween,
	isBackupDueNow,
} from "./schedule";

function destination(
	overrides: Partial<BackupDestinationRecord["runtime"]> = {},
): BackupDestinationRecord {
	return {
		id: "backup-test",
		name: "Test",
		type: "webdav",
		includeAttachments: false,
		destination: {
			baseUrl: "https://example.test/dav",
			username: "user",
			password: "secret",
			remotePath: "edgewarden",
		},
		schedule: {
			enabled: true,
			intervalHours: 24,
			startTime: "03:00",
			timezone: "Asia/Hong_Kong",
			retentionCount: 30,
		},
		runtime: {
			lastAttemptAt: null,
			lastAttemptLocalDate: null,
			lastSuccessAt: null,
			lastErrorAt: null,
			lastErrorMessage: null,
			lastUploadedFileName: null,
			lastUploadedSizeBytes: null,
			lastUploadedDestination: null,
			...overrides,
		},
	};
}

describe("backup schedules", () => {
	it("uses the configured local timezone", () => {
		expect(
			getBackupLocalDateKey(
				new Date("2026-08-11T16:30:00.000Z"),
				"Asia/Hong_Kong",
			),
		).toBe("2026-08-12");
	});

	it("runs inside the scheduler window only once per slot", () => {
		const now = new Date("2026-08-11T19:03:00.000Z");
		expect(isBackupDueNow(destination(), now)).toBe(true);
		expect(
			isBackupDueNow(
				destination({ lastAttemptAt: "2026-08-11T19:00:30.000Z" }),
				now,
			),
		).toBe(false);
	});

	it("finds a missed slot in a larger catch-up interval", () => {
		expect(
			hasBackupSlotBetween(
				destination(),
				new Date("2026-08-11T18:00:00.000Z"),
				new Date("2026-08-11T20:00:00.000Z"),
			),
		).toBe(true);
	});
});
