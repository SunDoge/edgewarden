import * as m from "$lib/paraglide/messages.js";
import {
  createFileSendApi,
  createSendApi,
  removeSendPasswordApi,
  updateSendApi,
} from "$lib/services/api-sends";
import { encryptBw, encryptBwFileData } from "$lib/services/crypto";
import type { SendEditorDraft } from "$lib/services/send-editor";
import {
  createSendKeys,
  deriveSendPasswordHash,
  encryptSendMetadata,
  wrapSendKey,
  type SendKeys,
  type DecryptedSend,
} from "$lib/services/send-crypto";
import type { SendMutationPayload } from "$lib/services/send-types";

export function validateSendDraft(form: SendEditorDraft, isCreating: boolean) {
  if (!form.name.trim()) throw new Error(m.ui_name_is_required_2());
  if (form.type === 0 && !form.textContent.trim()) {
    throw new Error(m.ui_text_content_is_required());
  }
  if (form.type === 1 && !form.file && isCreating) {
    throw new Error(m.ui_select_a_file_to_upload());
  }
  if (isCreating && form.protectWithPassword && !form.password) {
    throw new Error(
      m.ui_enter_an_access_password_when_password_protection_is_enabled(),
    );
  }
}

export async function saveOwnedSend({
  form,
  selectedSend,
  isCreating,
  isEditing,
  vaultKeys,
}: {
  form: SendEditorDraft;
  selectedSend: DecryptedSend | null;
  isCreating: boolean;
  isEditing: boolean;
  vaultKeys: { encKey: Uint8Array; macKey: Uint8Array };
}) {
  validateSendDraft(form, isCreating);
  if (isEditing && !selectedSend)
    throw new Error(m.ui_the_send_to_edit_could_not_be_found());
  const keys: SendKeys = selectedSend?._sendKeys ?? (await createSendKeys());
  const encrypted = await encryptSendMetadata(
    {
      name: form.name,
      notes: form.notes,
      ...(form.type === 0 ? { text: form.textContent } : {}),
    },
    keys,
  );
  const encryptedSendKey = selectedSend
    ? selectedSend.key
    : await wrapSendKey(keys, vaultKeys.encKey, vaultKeys.macKey);
  const payload: SendMutationPayload = {
    type: form.type,
    name: encrypted.name,
    notes: encrypted.notes,
    key: encryptedSendKey,
    deletionDate: new Date(
      Date.now() + form.deletionDays * 86_400_000,
    ).toISOString(),
    maxAccessCount: form.maxAccessCount || null,
    expirationDate: form.expirationDate
      ? new Date(form.expirationDate).toISOString()
      : null,
    disabled: form.disabled,
    hideEmail: form.hideEmail,
  };
  if (form.protectWithPassword && form.password) {
    payload.authType = 1;
    payload.password = await deriveSendPasswordHash(form.password, keys.raw);
  } else if (!form.protectWithPassword) payload.authType = 2;

  if (isCreating && form.type === 0) {
    payload.text = encrypted.text;
    await createSendApi(payload);
  } else if (isCreating && form.type === 1 && form.file) {
    await createAndUploadFileSend(payload, form.file, keys);
  } else if (isEditing && selectedSend) {
    if (form.type === 0) payload.text = encrypted.text;
    await updateSendApi(selectedSend.id, payload);
    if (selectedSend.password && !form.protectWithPassword) {
      await removeSendPasswordApi(selectedSend.id);
    }
  }
}

async function createAndUploadFileSend(
  payload: SendMutationPayload,
  file: File,
  keys: SendKeys,
) {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encryptedFileBytes = await encryptBwFileData(
    fileBytes,
    keys.enc,
    keys.mac,
  );
  payload.file = {
    fileName: await encryptBw(
      new TextEncoder().encode(file.name),
      keys.enc,
      keys.mac,
    ),
    sizeName: `${(fileBytes.length / 1024 / 1024).toFixed(2)} MB`,
  };
  payload.fileLength = encryptedFileBytes.length;
  const response = await createFileSendApi(payload);
  const uploadResponse = await fetch(response.url, {
    method: "PUT",
    body: new Blob([encryptedFileBytes as BlobPart]),
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!uploadResponse.ok) {
    throw new Error(
      m.ui_file_upload_failed_value({ value0: uploadResponse.status }),
    );
  }
}
