const DEVICE_IDENTIFIER_KEY = "edgewarden.device.identifier";

export const WEB_DEVICE_TYPE = 14;

export function getOrCreateDeviceIdentifier(storage: Pick<Storage, "getItem" | "setItem"> = localStorage, randomUUID: () => string = () => crypto.randomUUID()): string {
	const current = storage.getItem(DEVICE_IDENTIFIER_KEY)?.trim();
	if (current) return current;
	const identifier = randomUUID();
	storage.setItem(DEVICE_IDENTIFIER_KEY, identifier);
	return identifier;
}

export function getCurrentDeviceIdentifier(storage: Pick<Storage, "getItem"> = localStorage): string {
	return storage.getItem(DEVICE_IDENTIFIER_KEY)?.trim() ?? "";
}

export function browserDeviceName(userAgent = navigator.userAgent): string {
	const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
	const platform = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "Web";
	return `${browser} on ${platform}`;
}
