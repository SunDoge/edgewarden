import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { YubicoCredentials } from "../utils/yubico";

const CONFIG_KEY = "security.yubico.credentials.v1";

function bytesBase64(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64Bytes(value: string): Uint8Array {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
	const material = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`edgewarden:yubico-config:v1:${secret}`),
	);
	return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

export async function saveYubicoCredentials(
	db: Kysely<DB>,
	dataEncryptionSecret: string,
	credentials: YubicoCredentials,
): Promise<void> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await encryptionKey(dataEncryptionSecret),
		plaintext,
	);
	const value = JSON.stringify({
		iv: bytesBase64(iv),
		data: bytesBase64(new Uint8Array(ciphertext)),
	});
	await db
		.insertInto("config")
		.values({ key: CONFIG_KEY, value })
		.onConflict((conflict) => conflict.column("key").doUpdateSet({ value }))
		.execute();
}

export async function loadYubicoCredentials(
	db: Kysely<DB>,
	env: CloudflareBindings,
): Promise<YubicoCredentials | null> {
	const envClientId = String((env as any).YUBICO_CLIENT_ID ?? "").trim();
	const envSecret = String((env as any).YUBICO_SECRET_KEY ?? "").trim();
	if (envClientId && envSecret)
		return { clientId: envClientId, secretKey: envSecret };
	const row = await db
		.selectFrom("config")
		.select("value")
		.where("key", "=", CONFIG_KEY)
		.executeTakeFirst();
	if (!row) return null;
	try {
		const encrypted = JSON.parse(row.value) as { iv: string; data: string };
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: base64Bytes(encrypted.iv) },
			await encryptionKey(env.DATA_ENCRYPTION_SECRET),
			base64Bytes(encrypted.data),
		);
		const parsed = JSON.parse(
			new TextDecoder().decode(plaintext),
		) as YubicoCredentials;
		return parsed.clientId && parsed.secretKey ? parsed : null;
	} catch {
		return null;
	}
}
