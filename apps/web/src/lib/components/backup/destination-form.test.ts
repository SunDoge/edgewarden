import { describe, expect, it } from "vitest";
import {
	applyBackupDestinationForm,
	backupDestinationToForm,
} from "./destination-form";
import type { BackupDestinationRecord } from "./types";

const destination: BackupDestinationRecord = {
	id: "backup-1",
	name: "Remote",
	type: "webdav",
	includeAttachments: false,
	destination: {
		baseUrl: "https://dav.example.test/",
		username: " user ",
		password: "secret",
		remotePath: "edgewarden",
	},
	schedule: {
		enabled: true,
		intervalHours: 12,
		startTime: "04:00",
		timezone: "UTC",
		retentionCount: 10,
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
	},
};

describe("backup destination form", () => {
	it("uses the reserved native R2 prefix", () => {
		const form = backupDestinationToForm({
			...destination,
			type: "r2",
			destination: { rootPath: "backups" },
		});
		form.name = " ";

		const updated = applyBackupDestinationForm(destination, form);

		expect(updated).toMatchObject({
			name: "Cloudflare R2 备份",
			type: "r2",
			destination: { rootPath: "backups" },
		});
	});

	it("maps stored configuration into editable form state", () => {
		const form = backupDestinationToForm(destination);
		expect(form).toMatchObject({
			name: "Remote",
			type: "webdav",
			davBaseUrl: "https://dav.example.test/",
			scheduleInterval: 12,
		});
	});

	it("normalizes form values while preserving runtime state", () => {
		const form = backupDestinationToForm(destination);
		form.name = " ";
		form.type = "s3";
		form.s3Endpoint = " https://s3.example.test ";
		form.s3Bucket = " backups ";
		const updated = applyBackupDestinationForm(destination, form);
		expect(updated.name).toBe("S3 备份");
		expect(updated.destination).toMatchObject({
			endpoint: "https://s3.example.test",
			bucket: "backups",
		});
		expect(updated.runtime).toBe(destination.runtime);
	});
});
