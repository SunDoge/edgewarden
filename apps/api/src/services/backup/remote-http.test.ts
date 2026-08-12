import { describe, expect, it, vi } from "vitest";
import {
	readBoundedResponseBytes,
	readBoundedResponseText,
} from "./remote-http";

describe("bounded remote responses", () => {
	it("reads bounded response bytes and text", async () => {
		await expect(
			readBoundedResponseText(new Response("metadata"), 8, "listing"),
		).resolves.toBe("metadata");
		await expect(
			readBoundedResponseBytes(
				new Response(new Uint8Array([1, 2, 3])),
				3,
				"file",
			),
		).resolves.toEqual(new Uint8Array([1, 2, 3]));
	});

	it("rejects oversized declared responses before buffering", async () => {
		const cancelled = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
		await expect(
			readBoundedResponseBytes(
				new Response(body, { headers: { "content-length": "9" } }),
				8,
				"backup",
			),
		).rejects.toThrow("backup exceeds the 8 byte limit");
		expect(cancelled).toHaveBeenCalledOnce();
	});

	it("cancels chunked responses as soon as the stream exceeds the limit", async () => {
		const cancelled = vi.fn();
		const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks.shift();
				if (chunk) controller.enqueue(chunk);
				else controller.close();
			},
			cancel: cancelled,
		});
		await expect(
			readBoundedResponseBytes(new Response(body), 5, "listing"),
		).rejects.toThrow("listing exceeds the 5 byte limit");
		expect(cancelled).toHaveBeenCalledOnce();
	});
});
