export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  twoFactorEnabled: boolean;
  creationDate: string;
  revisionDate: string;
  object: string;
}

export interface AdminInvite {
  code: string;
  email: string | null;
  status: string;
  createdBy: string;
  usedBy: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  inviteLink: string;
  object: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  category: string;
  level: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  object: string;
}

export interface ApiList<T> {
  data: T[];
}
