import { describe, expect, it } from "vitest";
import { buildAwsV4Authorization, sha256Hex } from "./aws-signature";

describe("AWS Signature V4", () => {
	it("hashes request payloads as lowercase SHA-256 hex", async () => {
		expect(await sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("produces a deterministic S3 authorization header", async () => {
		const payloadHash = await sha256Hex(new Uint8Array());
		const authorization = await buildAwsV4Authorization(
			"GET",
			new URL(
				"https://examplebucket.s3.amazonaws.com/test.txt?versionId=3&partNumber=1",
			),
			{
				host: "examplebucket.s3.amazonaws.com",
				"x-amz-date": "20130524T000000Z",
			},
			payloadHash,
			"AKIDEXAMPLE",
			"wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
			"us-east-1",
		);

		expect(authorization).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=afa37f7ad14165735f7261623647be545c67734259a8ce93e3a27200d73cac93",
		);
	});
});
