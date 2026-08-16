import { safeParseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";

export const SIGNALR_RECORD_SEPARATOR = String.fromCharCode(0x1e);
export const SIGNALR_HANDSHAKE_ACK = new TextEncoder().encode(
	`{}${SIGNALR_RECORD_SEPARATOR}`,
);
export const SIGNALR_SYNC_VAULT = 5;

export type SignalRProtocol = "json" | "messagepack";
const SignalRHandshakeSchema = v.object({
	protocol: v.picklist(["json", "messagepack"]),
});

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const output = new Uint8Array(
		chunks.reduce((length, chunk) => length + chunk.length, 0),
	);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function encodeString(value: string): Uint8Array {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length < 32)
		return concatBytes([new Uint8Array([0xa0 | bytes.length]), bytes]);
	if (bytes.length <= 0xff)
		return concatBytes([new Uint8Array([0xd9, bytes.length]), bytes]);
	return concatBytes([
		new Uint8Array([0xda, bytes.length >> 8, bytes.length & 0xff]),
		bytes,
	]);
}

function encodeInteger(value: number): Uint8Array {
	const integer = Math.trunc(value);
	if (integer >= 0 && integer <= 0x7f) return new Uint8Array([integer]);
	if (integer >= 0 && integer <= 0xff) return new Uint8Array([0xcc, integer]);
	const unsigned = integer >>> 0;
	return new Uint8Array([
		0xce,
		(unsigned >>> 24) & 0xff,
		(unsigned >>> 16) & 0xff,
		(unsigned >>> 8) & 0xff,
		unsigned & 0xff,
	]);
}

function encodeArray(values: unknown[]): Uint8Array {
	const header =
		values.length < 16
			? new Uint8Array([0x90 | values.length])
			: new Uint8Array([0xdc, values.length >> 8, values.length & 0xff]);
	return concatBytes([header, ...values.map(encodeMessagePack)]);
}

function encodeMap(value: Record<string, unknown>): Uint8Array {
	const entries = Object.entries(value);
	const header =
		entries.length < 16
			? new Uint8Array([0x80 | entries.length])
			: new Uint8Array([0xde, entries.length >> 8, entries.length & 0xff]);
	return concatBytes([
		header,
		...entries.flatMap(([key, item]) => [
			encodeString(key),
			encodeMessagePack(item),
		]),
	]);
}

function encodeMessagePack(value: unknown): Uint8Array {
	if (value == null) return new Uint8Array([0xc0]);
	if (typeof value === "string") return encodeString(value);
	if (typeof value === "number") return encodeInteger(value);
	if (typeof value === "boolean") return new Uint8Array([value ? 0xc3 : 0xc2]);
	if (Array.isArray(value)) return encodeArray(value);
	return encodeMap(value as Record<string, unknown>);
}

function frameBinary(payload: Uint8Array): Uint8Array {
	const prefix: number[] = [];
	let length = payload.length;
	do {
		let byte = length & 0x7f;
		length >>>= 7;
		if (length) byte |= 0x80;
		prefix.push(byte);
	} while (length);
	return concatBytes([new Uint8Array(prefix), payload]);
}

export function parseSignalRHandshake(
	message: string | ArrayBuffer | ArrayBufferView,
): SignalRProtocol | null {
	const text =
		typeof message === "string"
			? message
			: new TextDecoder().decode(
					ArrayBuffer.isView(message)
						? new Uint8Array(
								message.buffer,
								message.byteOffset,
								message.byteLength,
							)
						: new Uint8Array(message),
				);
	for (const frame of text.split(SIGNALR_RECORD_SEPARATOR).filter(Boolean)) {
		const handshake = safeParseJsonWithSchema(frame, SignalRHandshakeSchema);
		if (handshake) return handshake.protocol;
	}
	return null;
}

export function encodeSignalRInvocation(
	protocol: SignalRProtocol,
	updateType: number,
	payload: Record<string, unknown>,
	contextId: string | null = null,
): string | Uint8Array {
	const notification = {
		ContextId: contextId,
		Type: updateType,
		Payload: payload,
	};
	if (protocol === "json") {
		return `${JSON.stringify({ type: 1, target: "ReceiveMessage", arguments: [notification] })}${SIGNALR_RECORD_SEPARATOR}`;
	}
	return frameBinary(
		encodeMessagePack([1, {}, null, "ReceiveMessage", [notification], []]),
	);
}
