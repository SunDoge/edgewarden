export interface BackupDestinationRecord {
	id: string;
	name: string;
	type: "s3" | "webdav";
	includeAttachments: boolean;
	destination: {
		endpoint?: string;
		bucket?: string;
		region?: string;
		accessKeyId?: string;
		secretAccessKey?: string;
		rootPath?: string;
		addressingStyle?: "path-style" | "virtual-hosted-style";
		baseUrl?: string;
		username?: string;
		password?: string;
		remotePath?: string;
	};
	schedule: {
		enabled: boolean;
		intervalHours: number;
		startTime: string;
		timezone: string;
		retentionCount: number | null;
	};
	runtime: {
		lastAttemptAt: string | null;
		lastAttemptLocalDate: string | null;
		lastSuccessAt: string | null;
		lastErrorAt: string | null;
		lastErrorMessage: string | null;
		lastUploadedFileName: string | null;
		lastUploadedSizeBytes: number | null;
		lastUploadedDestination: string | null;
	};
}

export interface BackupSettings {
	destinations: BackupDestinationRecord[];
}
