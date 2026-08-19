import {
  createAttachmentApi,
  deleteAttachmentApi,
  downloadAttachmentApi,
  uploadAttachmentApi,
} from "./api-vault";
import {
  type AttachmentKeys,
  decryptAttachmentFile,
  prepareAttachment,
  safeAttachmentFileName,
} from "./attachment-crypto";

export interface VaultOwnerKeys {
  encKey: Uint8Array;
  macKey: Uint8Array;
}

export async function uploadVaultAttachment(
  cipher: { id: string; key: string | null },
  file: File,
  ownerKeys: VaultOwnerKeys,
): Promise<void> {
  const prepared = await prepareAttachment(
    cipher,
    file,
    ownerKeys.encKey,
    ownerKeys.macKey,
  );
  const created = await createAttachmentApi(cipher.id, prepared.metadata);
  try {
    await uploadAttachmentApi(created.url, prepared.encryptedData);
  } catch (error) {
    await deleteAttachmentApi(cipher.id, created.attachmentId).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function downloadVaultAttachment(
  cipherId: string,
  attachment: {
    id: string;
    fileName: string;
    _keys: AttachmentKeys;
  },
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const encrypted = await downloadAttachmentApi(cipherId, attachment.id);
  return {
    bytes: await decryptAttachmentFile(encrypted, attachment._keys),
    fileName: safeAttachmentFileName(attachment.fileName),
  };
}
