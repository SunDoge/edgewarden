export interface SendEditorDraft {
	type: number;
	name: string;
	notes: string;
	textContent: string;
	file: File | null;
	maxAccessCount: number | null;
	expirationDate: string;
	deletionDays: number;
	password: string;
	protectWithPassword: boolean;
	hideEmail: boolean;
	disabled: boolean;
}

export function createSendEditorDraft(): SendEditorDraft {
	return {
		type: 0,
		name: "",
		notes: "",
		textContent: "",
		file: null,
		maxAccessCount: null,
		expirationDate: "",
		deletionDays: 7,
		password: "",
		protectWithPassword: false,
		hideEmail: false,
		disabled: false,
	};
}

export function sendToEditorDraft(
	send: Pick<DecryptedSend, "type" | "name" | "deletionDate"> &
		Partial<
			Pick<
				DecryptedSend,
				| "notes"
				| "text"
				| "maxAccessCount"
				| "expirationDate"
				| "password"
				| "hideEmail"
				| "disabled"
			>
		>,
	now = Date.now(),
): SendEditorDraft {
	return {
		type: send.type,
		name: send.name,
		notes: send.notes ?? "",
		textContent: send.text?.text ?? "",
		file: null,
		maxAccessCount: send.maxAccessCount ?? null,
		expirationDate: send.expirationDate
			? new Date(send.expirationDate).toISOString().slice(0, 16)
			: "",
		deletionDays: Math.max(
			1,
			Math.min(
				30,
				Math.ceil((new Date(send.deletionDate).getTime() - now) / 86_400_000),
			),
		),
		password: "",
		protectWithPassword: Boolean(send.password),
		hideEmail: Boolean(send.hideEmail),
		disabled: Boolean(send.disabled),
	};
}
import type { DecryptedSend } from "./send-crypto";
