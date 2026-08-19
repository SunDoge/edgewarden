export interface BackupDestinationRecord {
  id: string;
  name: string;
  type: "r2" | "s3" | "webdav";
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

export interface RemoteBackupItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
  modifiedAt: string | null;
}

export interface RemoteBackupListResult {
  provider: "r2" | "s3" | "webdav";
  currentPath: string;
  parentPath: string | null;
  items: RemoteBackupItem[];
}

export interface BackupRunResult {
  result: {
    fileName: string;
    fileSize: number;
    remotePath: string;
    provider: "r2" | "s3" | "webdav";
    prunedCount: number;
  };
  settings: BackupSettings;
}

export interface BackupIntegrityResult {
  integrity: {
    valid: boolean;
    reason: string | null;
    [key: string]: unknown;
  };
}

export interface BackupImportResult {
  object: string;
  imported: Record<string, number>;
  skipped: unknown;
}
