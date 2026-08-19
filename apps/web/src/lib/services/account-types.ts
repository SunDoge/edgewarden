export interface AccountProfile {
  id: string;
  name: string | null;
  email: string;
  key: string;
  privateKey: string | null;
  publicKey: string | null;
  kdf: number;
  kdfIterations: number;
  kdfMemory: number | null;
  kdfParallelism: number | null;
  twoFactorEnabled: boolean;
  masterPasswordHint: string | null;
  object: string;
}

export interface AccountDevice {
  id: string;
  name: string;
  type: number;
  identifier: string;
  creationDate: string;
  revisionDate: string;
  lastLoginDate: string | null;
  encryptedUserKey: string | null;
  encryptedPublicKey: string | null;
  encryptedPrivateKey: string | null;
  isTrusted: boolean;
  object: string;
}

export interface TwoFactorProvider {
  enabled: boolean;
  type: number;
  object: string;
}

export interface AccountPasskey {
  id: string;
  name: string | null;
  creationDate?: string | null;
  revisionDate?: string | null;
  prfStatus: number;
  encryptedPublicKey?: string | null;
  encryptedUserKey?: string | null;
  object?: string;
}

export interface ApiList<T> {
  data: T[];
}
