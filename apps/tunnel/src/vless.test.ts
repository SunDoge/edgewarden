import { describe, expect, it } from "vitest";
import { isPublicDestination, parseVlessRequest } from "./vless";

const UUID = Uint8Array.from([
	0x10, 0x98, 0x2a, 0x88, 0x05, 0xa9, 0x4c, 0x5d, 0x91, 0x42, 0x0f, 0x61, 0x8b,
	0x07, 0xc9, 0x4a,
]);

describe("parseVlessRequest", () => {
	it("parses a domain request without copying its initial payload", () => {
		const domain = new TextEncoder().encode("example.com");
		const payload = Uint8Array.from([1, 2, 3, 4]);
		const frame = Uint8Array.from([
			0,
			...UUID,
			0,
			1,
			1,
			187,
			2,
			domain.length,
			...domain,
			...payload,
		]);

		const request = parseVlessRequest(frame.buffer);
		expect(request.hostname).toBe("example.com");
		expect(request.port).toBe(443);
		expect(request.payload).toEqual(payload);
		expect(request.payload.buffer).toBe(frame.buffer);
	});

	it("parses an offset typed-array view without copying it", () => {
		const encoded = Uint8Array.from([
			99,
			0,
			...UUID,
			0,
			1,
			0,
			80,
			1,
			1,
			1,
			1,
			1,
			7,
		]);
		const frame = encoded.subarray(1);
		const request = parseVlessRequest(frame);
		expect(request.hostname).toBe("1.1.1.1");
		expect(request.payload).toEqual(Uint8Array.of(7));
		expect(request.payload.buffer).toBe(encoded.buffer);
	});

	it("rejects UDP and truncated frames", () => {
		const udp = Uint8Array.from([0, ...UUID, 0, 2, 0, 53, 1, 8, 8, 8, 8]);
		expect(() => parseVlessRequest(udp.buffer)).toThrow("only TCP");
		expect(() => parseVlessRequest(new ArrayBuffer(8))).toThrow("truncated");
	});

	it("rejects every truncated prefix of a valid domain request", () => {
		const domain = new TextEncoder().encode("example.com");
		const frame = Uint8Array.from([
			0,
			...UUID,
			0,
			1,
			1,
			187,
			2,
			domain.length,
			...domain,
		]);
		for (let end = 0; end < frame.byteLength; end += 1) {
			expect(() => parseVlessRequest(frame.slice(0, end))).toThrow();
		}
	});
});

describe("isPublicDestination", () => {
	it.each(["1.1.1.1", "8.8.8.8", "example.com", "2606:4700:4700:0:0:0:0:1111"])(
		"allows public destination %s",
		(destination) => expect(isPublicDestination(destination)).toBe(true),
	);

	it.each([
		"localhost",
		"service.internal",
		"10.0.0.1",
		"127.0.0.1",
		"169.254.1.1",
		"172.16.0.1",
		"192.168.1.1",
		"192.0.2.1",
		"0:0:0:0:0:0:0:1",
		"fd00:0:0:0:0:0:0:1",
		"0:0:0:0:0:ffff:7f00:1",
		"2001:db8:0:0:0:0:0:1",
	])("rejects non-public destination %s", (destination) =>
		expect(isPublicDestination(destination)).toBe(false),
	);
});
