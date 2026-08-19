export interface SendTextData extends Record<string, unknown> {
  text: string;
  hidden?: boolean;
}

export interface SendFileData {
  id: string;
  fileName: string;
  sizeName?: string;
  size?: number;
}

export interface OwnedSend {
  id: string;
  accessId: string;
  type: number;
  name: string;
  notes: string | null;
  text: SendTextData | null;
  file: SendFileData | null;
  key: string;
  maxAccessCount: number | null;
  accessCount: number;
  password: string | null;
  authType: number | null;
  disabled: boolean;
  hideEmail: boolean;
  revisionDate: string | null;
  expirationDate: string | null;
  deletionDate: string;
  object: string;
}

export interface PublicSend {
  id: string;
  type: number;
  name: string;
  text: SendTextData | string | null;
  file: SendFileData | null;
  expirationDate: string | null;
  deletionDate: string | null;
  creatorIdentifier: string | null;
  object: string;
}

export type EncryptedOwnedSend = Pick<
  OwnedSend,
  "id" | "type" | "name" | "key"
> &
  Partial<Omit<OwnedSend, "id" | "type" | "name" | "key">>;

export type EncryptedPublicSend = Pick<PublicSend, "type" | "name"> &
  Partial<Omit<PublicSend, "type" | "name">>;

export interface SendMutationPayload {
  type: number;
  name: string;
  notes: string | null;
  key: string;
  deletionDate: string;
  maxAccessCount: number | null;
  expirationDate: string | null;
  disabled: boolean;
  hideEmail: boolean;
  authType?: number;
  password?: string;
  text?: SendTextData;
  file?: Omit<SendFileData, "id">;
  fileLength?: number;
}

export interface FileSendUpload {
  url: string;
  fileUploadType?: number;
  object?: string;
}
