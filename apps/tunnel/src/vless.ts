const textDecoder = new TextDecoder("utf-8", { fatal: true });

export interface VlessRequest {
	version: number;
	userId: Uint8Array;
	hostname: string;
	port: number;
	payload: Uint8Array;
}

export class VlessProtocolError extends Error {}

export function parseVlessRequest(
	frame: ArrayBuffer | ArrayBufferView,
): VlessRequest {
	const bytes = toUint8Array(frame);
	if (bytes.byteLength < 24)
		throw new VlessProtocolError("request is truncated");

	let offset = 0;
	const version = bytes[offset++];
	if (version !== 0) throw new VlessProtocolError("unsupported VLESS version");
	const userId = bytes.subarray(offset, offset + 16);
	offset += 16;

	const optionLength = bytes[offset++];
	offset = checkedAdvance(offset, optionLength, bytes.byteLength);
	if (offset >= bytes.byteLength)
		throw new VlessProtocolError("request is truncated");
	const command = bytes[offset++];
	if (command !== 1) throw new VlessProtocolError("only TCP is supported");
	offset = checkedAdvance(offset, 2, bytes.byteLength);
	const port = (bytes[offset - 2] << 8) | bytes[offset - 1];
	if (port === 0) throw new VlessProtocolError("port must not be zero");

	if (offset >= bytes.byteLength)
		throw new VlessProtocolError("request is truncated");
	const addressType = bytes[offset++];
	let hostname: string;
	if (addressType === 1) {
		offset = checkedAdvance(offset, 4, bytes.byteLength);
		hostname = Array.from(bytes.subarray(offset - 4, offset)).join(".");
	} else if (addressType === 2) {
		if (offset >= bytes.byteLength)
			throw new VlessProtocolError("request is truncated");
		const length = bytes[offset++];
		if (length === 0) throw new VlessProtocolError("domain must not be empty");
		offset = checkedAdvance(offset, length, bytes.byteLength);
		try {
			hostname = textDecoder.decode(bytes.subarray(offset - length, offset));
		} catch {
			throw new VlessProtocolError("domain is not valid UTF-8");
		}
	} else if (addressType === 3) {
		offset = checkedAdvance(offset, 16, bytes.byteLength);
		hostname = formatIpv6(bytes.subarray(offset - 16, offset));
	} else {
		throw new VlessProtocolError("unsupported address type");
	}

	return { version, userId, hostname, port, payload: bytes.subarray(offset) };
}

export function toUint8Array(frame: ArrayBuffer | ArrayBufferView): Uint8Array {
	return frame instanceof ArrayBuffer
		? new Uint8Array(frame)
		: new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
}

export function isPublicDestination(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	if (
		normalized === "localhost" ||
		normalized.endsWith(".localhost") ||
		normalized.endsWith(".local") ||
		normalized.endsWith(".internal") ||
		normalized.endsWith(".arpa")
	) {
		return false;
	}

	const ipv4 = parseIpv4(normalized);
	if (ipv4) return isPublicIpv4(ipv4);
	if (normalized.includes(":")) return isPublicIpv6(normalized);
	return isValidDomain(normalized);
}

function checkedAdvance(offset: number, length: number, total: number): number {
	const next = offset + length;
	if (next > total) throw new VlessProtocolError("request is truncated");
	return next;
}

function formatIpv6(bytes: Uint8Array): string {
	const groups: string[] = [];
	for (let index = 0; index < 16; index += 2) {
		groups.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
	}
	return groups.join(":");
}

function parseIpv4(value: string): number[] | null {
	const parts = value.split(".");
	if (parts.length !== 4) return null;
	const numbers = parts.map(Number);
	return numbers.every(
		(part, index) =>
			Number.isInteger(part) &&
			part >= 0 &&
			part <= 255 &&
			String(part) === parts[index],
	)
		? numbers
		: null;
}

function isPublicIpv4([a, b, c]: number[]): boolean {
	return !(
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function isPublicIpv6(value: string): boolean {
	const groups = value.split(":");
	if (
		groups.length !== 8 ||
		groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))
	) {
		return false;
	}
	const words = groups.map((group) => Number.parseInt(group, 16));
	const first = words[0];
	if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
		return isPublicIpv4([
			words[6] >> 8,
			words[6] & 0xff,
			words[7] >> 8,
			words[7] & 0xff,
		]);
	}
	return !(
		first === 0 ||
		(first & 0xfe00) === 0xfc00 ||
		(first & 0xffc0) === 0xfe80 ||
		(first & 0xff00) === 0xff00 ||
		(first === 0x2001 && words[1] === 0x0db8)
	);
}

function isValidDomain(value: string): boolean {
	if (value.length > 253 || !value.includes(".")) return false;
	return value
		.split(".")
		.every(
			(label) =>
				label.length > 0 &&
				label.length <= 63 &&
				/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
		);
}
