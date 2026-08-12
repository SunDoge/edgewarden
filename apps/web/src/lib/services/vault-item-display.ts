import { CipherType, type CipherResponse } from "@edgewarden/shared";
import {
	BookUser,
	CreditCard,
	FileText,
	IdCard,
	KeyRound,
	Landmark,
	Lock,
	User,
} from "@lucide/svelte";
import { match } from "ts-pattern";

export function cipherDomain(item: CipherResponse): string | null {
	if (item.type !== CipherType.Login) return null;
	const login = item.login as
		| { uri?: unknown; uris?: Array<{ uri?: unknown }> }
		| null;
	const uri = login?.uri ?? login?.uris?.[0]?.uri;
	if (typeof uri !== "string" || !uri.trim()) return null;
	try {
		const normalized = /^https?:\/\//i.test(uri.trim())
			? uri.trim()
			: `https://${uri.trim()}`;
		return new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		const host = uri.match(/^(?:https?:\/\/)?(?:www\.)?([^/?#:]+)/i)?.[1];
		return host?.toLowerCase() ?? null;
	}
}

export function cipherTypeIcon(type: number) {
	return match(type)
		.with(CipherType.Login, () => KeyRound)
		.with(CipherType.SecureNote, () => FileText)
		.with(CipherType.Card, () => CreditCard)
		.with(CipherType.Identity, () => User)
		.with(CipherType.SshKey, () => KeyRound)
		.with(CipherType.BankAccount, () => Landmark)
		.with(CipherType.DriversLicense, () => IdCard)
		.with(CipherType.Passport, () => BookUser)
		.otherwise(() => Lock);
}

export function cipherTypeName(type: number): string {
	return match(type)
		.with(CipherType.Login, () => "登录凭据")
		.with(CipherType.SecureNote, () => "安全便签")
		.with(CipherType.Card, () => "支付卡片")
		.with(CipherType.Identity, () => "个人身份")
		.with(CipherType.SshKey, () => "SSH 密钥")
		.with(CipherType.BankAccount, () => "银行账户")
		.with(CipherType.DriversLicense, () => "驾驶证")
		.with(CipherType.Passport, () => "护照")
		.otherwise(() => "保险库项");
}

export function cipherExtraData(
	item: CipherResponse,
): Record<string, unknown> | null {
	return match(item.type)
		.with(CipherType.SshKey, () => item.sshKey ?? null)
		.with(CipherType.BankAccount, () => item.bankAccount ?? null)
		.with(CipherType.DriversLicense, () => item.driversLicense ?? null)
		.with(CipherType.Passport, () => item.passport ?? null)
		.otherwise(() => null) as Record<string, unknown> | null;
}

export function formatVaultSyncTime(timestamp: number | null): string {
	if (!timestamp) return "";
	return new Date(timestamp).toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	});
}
