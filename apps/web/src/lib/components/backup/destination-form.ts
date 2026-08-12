import type { BackupDestinationRecord } from "./types";

export interface BackupDestinationForm {
	name: string;
	type: "s3" | "webdav";
	includeAttachments: boolean;
	s3Endpoint: string;
	s3Bucket: string;
	s3Region: string;
	s3AccessKeyId: string;
	s3SecretAccessKey: string;
	s3RootPath: string;
	s3AddressingStyle: "path-style" | "virtual-hosted-style";
	davBaseUrl: string;
	davUsername: string;
	davPassword: string;
	davRemotePath: string;
	scheduleEnabled: boolean;
	scheduleInterval: number;
	scheduleStartTime: string;
	scheduleTimezone: string;
	scheduleRetention: number | null;
}

export function createDefaultBackupDestinationForm(): BackupDestinationForm {
	return {
		name: "",
		type: "webdav",
		includeAttachments: false,
		s3Endpoint: "",
		s3Bucket: "",
		s3Region: "auto",
		s3AccessKeyId: "",
		s3SecretAccessKey: "",
		s3RootPath: "edgewarden",
		s3AddressingStyle: "path-style",
		davBaseUrl: "",
		davUsername: "",
		davPassword: "",
		davRemotePath: "edgewarden",
		scheduleEnabled: false,
		scheduleInterval: 24,
		scheduleStartTime: "03:00",
		scheduleTimezone: "UTC",
		scheduleRetention: 30,
	};
}

export function backupDestinationToForm(
	destination: BackupDestinationRecord,
): BackupDestinationForm {
	const form = createDefaultBackupDestinationForm();
	form.name = destination.name;
	form.type = destination.type;
	form.includeAttachments = destination.includeAttachments;
	if (destination.type === "s3") {
		form.s3Endpoint = destination.destination.endpoint || "";
		form.s3Bucket = destination.destination.bucket || "";
		form.s3Region = destination.destination.region || "auto";
		form.s3AccessKeyId = destination.destination.accessKeyId || "";
		form.s3SecretAccessKey = destination.destination.secretAccessKey || "";
		form.s3RootPath = destination.destination.rootPath || "edgewarden";
		form.s3AddressingStyle =
			destination.destination.addressingStyle || "path-style";
	} else {
		form.davBaseUrl = destination.destination.baseUrl || "";
		form.davUsername = destination.destination.username || "";
		form.davPassword = destination.destination.password || "";
		form.davRemotePath = destination.destination.remotePath || "edgewarden";
	}
	form.scheduleEnabled = destination.schedule.enabled;
	form.scheduleInterval = destination.schedule.intervalHours;
	form.scheduleStartTime = destination.schedule.startTime;
	form.scheduleTimezone = destination.schedule.timezone;
	form.scheduleRetention = destination.schedule.retentionCount;
	return form;
}

export function applyBackupDestinationForm(
	destination: BackupDestinationRecord,
	form: BackupDestinationForm,
): BackupDestinationRecord {
	return {
		...destination,
		name: form.name.trim() || (form.type === "s3" ? "S3 备份" : "WebDAV 备份"),
		type: form.type,
		includeAttachments: form.includeAttachments,
		destination:
			form.type === "s3"
				? {
						endpoint: form.s3Endpoint.trim(),
						bucket: form.s3Bucket.trim(),
						addressingStyle: form.s3AddressingStyle,
						region: form.s3Region.trim(),
						accessKeyId: form.s3AccessKeyId.trim(),
						secretAccessKey: form.s3SecretAccessKey,
						rootPath: form.s3RootPath.trim(),
					}
				: {
						baseUrl: form.davBaseUrl.trim(),
						username: form.davUsername.trim(),
						password: form.davPassword,
						remotePath: form.davRemotePath.trim(),
					},
		schedule: {
			enabled: form.scheduleEnabled,
			intervalHours: form.scheduleInterval,
			startTime: form.scheduleStartTime,
			timezone: form.scheduleTimezone,
			retentionCount: form.scheduleRetention,
		},
	};
}
