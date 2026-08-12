import {
	createFileSendApi,
	createSendApi,
	removeSendPasswordApi,
	updateSendApi,
} from "$lib/services/api";
import { encryptBw, encryptBwFileData } from "$lib/services/crypto";
import type { SendEditorDraft } from "$lib/services/send-editor";
import {
	createSendKeys,
	encryptSendMetadata,
	wrapSendKey,
	type SendKeys,
} from "$lib/services/send-crypto";

export function validateSendDraft(form: SendEditorDraft, isCreating: boolean) {
	if (!form.name.trim()) throw new Error("名称不能为空！");
	if (form.type === 0 && !form.textContent.trim()) {
		throw new Error("文本内容不能为空！");
	}
	if (form.type === 1 && !form.file && isCreating) {
		throw new Error("请选择要上传的文件！");
	}
	if (isCreating && form.protectWithPassword && !form.password) {
		throw new Error("启用密码保护时必须输入访问密码！");
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
	selectedSend: any | null;
	isCreating: boolean;
	isEditing: boolean;
	vaultKeys: { encKey: Uint8Array; macKey: Uint8Array };
}) {
	validateSendDraft(form, isCreating);
	const keys: SendKeys = isEditing ? selectedSend._sendKeys : createSendKeys();
	const encrypted = await encryptSendMetadata(
		{
			name: form.name,
			notes: form.notes,
			...(form.type === 0 ? { text: form.textContent } : {}),
		},
		keys,
	);
	const encryptedSendKey = isEditing
		? selectedSend.key
		: await wrapSendKey(keys, vaultKeys.encKey, vaultKeys.macKey);
	const payload: any = {
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
		payload.password = form.password;
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
	payload: any,
	file: File,
	keys: SendKeys,
) {
	const fileBytes = new Uint8Array(await file.arrayBuffer());
	const encryptedFileBytes = await encryptBwFileData(fileBytes, keys.enc, keys.mac);
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
		throw new Error(`文件 payload 上传失败: ${uploadResponse.status}`);
	}
}
