export async function sha256Hex(value: Uint8Array | string): Promise<string> {
	const bytes =
		typeof value === "string" ? new TextEncoder().encode(value) : value;
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function hmacSha256Raw(
	keyBytes: Uint8Array,
	message: string,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(message),
	);
	return new Uint8Array(signature);
}

function buildCanonicalQueryString(url: URL): string {
	const params = Array.from(url.searchParams.entries()).sort(
		([aKey, aValue], [bKey, bValue]) => {
			if (aKey === bKey) return aValue.localeCompare(bValue);
			return aKey.localeCompare(bKey);
		},
	);
	return params
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join("&");
}

export async function buildAwsV4Authorization(
	method: string,
	url: URL,
	headers: Record<string, string>,
	payloadHashHex: string,
	accessKeyId: string,
	secretAccessKey: string,
	region: string,
): Promise<string> {
	const amzDate = headers["x-amz-date"];
	const shortDate = amzDate.slice(0, 8);
	const headerEntries = Object.entries(headers)
		.map(([name, value]) => [name.toLowerCase(), value] as const)
		.sort(([a], [b]) => a.localeCompare(b));
	const canonicalHeaders = headerEntries
		.map(
			([name, value]) => `${name}:${String(value).trim().replace(/\s+/g, " ")}`,
		)
		.join("\n");
	const signedHeaders = headerEntries.map(([name]) => name).join(";");
	const canonicalRequest = [
		method.toUpperCase(),
		url.pathname || "/",
		buildCanonicalQueryString(url),
		`${canonicalHeaders}\n`,
		signedHeaders,
		payloadHashHex,
	].join("\n");
	const credentialScope = `${shortDate}/${region}/s3/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		await sha256Hex(canonicalRequest),
	].join("\n");

	const kDate = await hmacSha256Raw(
		new TextEncoder().encode(`AWS4${secretAccessKey}`),
		shortDate,
	);
	const kRegion = await hmacSha256Raw(kDate, region);
	const kService = await hmacSha256Raw(kRegion, "s3");
	const kSigning = await hmacSha256Raw(kService, "aws4_request");
	const signatureBytes = await hmacSha256Raw(kSigning, stringToSign);
	const signature = Array.from(signatureBytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

	return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
