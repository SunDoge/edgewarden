import { toast } from "svelte-sonner";
import { deleteAttachmentApi } from "./api-vault";
import {
  downloadVaultAttachment,
  uploadVaultAttachment,
} from "./vault-attachments";
import type { VaultAttachment, VaultCipher } from "./vault-types";
import {
  getOrganizationKey,
  syncVaultData,
  vault,
} from "$lib/stores/vault.svelte";
import { errorDetail } from "./error-message";

export function createVaultAttachmentManager(options: {
  selected(): VaultCipher | null;
  select(cipher: VaultCipher | null): void;
  confirmDelete(attachment: VaultAttachment): void;
}) {
  let busy = $state<string | null>(null);

  async function refresh(id: string) {
    await syncVaultData();
    options.select(vault.ciphers.find((cipher) => cipher.id === id) ?? null);
  }

  return {
    get busy() {
      return busy;
    },
    async upload(event: Event) {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      const cipher = options.selected();
      input.value = "";
      if (!file || !cipher || cipher.deletedDate || cipher.readOnly) return;
      const ownerKey = cipher.organizationId
        ? getOrganizationKey(cipher.organizationId)
        : vault.symEncKey && vault.symMacKey
          ? { encKey: vault.symEncKey, macKey: vault.symMacKey }
          : null;
      if (!ownerKey) {
        toast.error("密钥未就绪，请重新解锁保险库");
        return;
      }
      busy = "upload";
      try {
        await uploadVaultAttachment(cipher, file, ownerKey);
        await refresh(cipher.id);
      } catch (caught) {
        toast.error(`附件上传失败：${errorDetail(caught)}`);
      } finally {
        busy = null;
      }
    },
    async download(attachment: VaultAttachment) {
      const cipher = options.selected();
      if (!cipher) return;
      busy = attachment.id;
      try {
        const downloaded = await downloadVaultAttachment(cipher.id, attachment);
        const bytes = downloaded.bytes.buffer.slice(
          downloaded.bytes.byteOffset,
          downloaded.bytes.byteOffset + downloaded.bytes.byteLength,
        ) as ArrayBuffer;
        const url = URL.createObjectURL(new Blob([bytes]));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = downloaded.fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch (caught) {
        toast.error(`附件下载失败：${errorDetail(caught)}`);
      } finally {
        busy = null;
      }
    },
    requestDelete(attachment: VaultAttachment) {
      const cipher = options.selected();
      if (cipher?.readOnly) {
        toast.error("该组织条目为只读");
        return;
      }
      if (cipher) options.confirmDelete(attachment);
    },
    async remove(attachment: VaultAttachment) {
      const cipher = options.selected();
      if (!cipher) return;
      busy = attachment.id;
      try {
        await deleteAttachmentApi(cipher.id, attachment.id);
        await refresh(cipher.id);
      } catch (caught) {
        toast.error(`附件删除失败：${errorDetail(caught)}`);
      } finally {
        busy = null;
      }
    },
  };
}
