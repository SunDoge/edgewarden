export async function readBoundedResponseBytes(
	response: Response,
	maxBytes: number,
	label: string,
): Promise<Uint8Array> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new Error(`Invalid ${label} byte limit`);
	}
	const declared = Number(response.headers.get("content-length") ?? 0);
	if (declared > maxBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error(`${label} exceeds the ${maxBytes} byte limit`);
	}
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const initialCapacity =
		Number.isSafeInteger(declared) && declared > 0
			? declared
			: Math.min(maxBytes, 8 * 1024);
	let output = new Uint8Array(initialCapacity);
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const nextTotal = total + value.byteLength;
			if (nextTotal > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new Error(`${label} exceeds the ${maxBytes} byte limit`);
			}
			if (nextTotal > output.byteLength) {
				let nextCapacity = Math.max(1, output.byteLength);
				while (nextCapacity < nextTotal) {
					nextCapacity = Math.min(maxBytes, nextCapacity * 2);
				}
				const expanded = new Uint8Array(nextCapacity);
				expanded.set(output.subarray(0, total));
				output = expanded;
			}
			output.set(value, total);
			total = nextTotal;
		}
	} finally {
		reader.releaseLock();
	}
	return output.subarray(0, total);
}

export async function readBoundedResponseText(
	response: Response,
	maxBytes: number,
	label: string,
): Promise<string> {
	return new TextDecoder().decode(
		await readBoundedResponseBytes(response, maxBytes, label),
	);
}
