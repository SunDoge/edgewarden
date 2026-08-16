import { afterEach, describe, expect, it, vi } from "vitest";
import type { S3BackupDestination } from "./config";
import { MAX_BACKUP_ARCHIVE_BYTES } from "./limits";
import {
	downloadFromS3,
	listS3Entries,
	normalizeS3ObjectKey,
	putToS3,
} from "./s3-adapter";

const config: S3BackupDestination = {
	endpoint: "https://s3.example.test",
	bucket: "backups",
	addressingStyle: "path-style",
	region: "auto",
	accessKeyId: "access-key",
	secretAccessKey: "secret-key",
	rootPath: "edgewarden",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("S3 backup adapter", () => {
	it("normalizes object keys beneath the configured root", () => {
		expect(normalizeS3ObjectKey(config, "/daily/backup.zip")).toBe(
			"edgewarden/daily/backup.zip",
		);
	});

	it("lists direct prefixes and objects from ListObjectsV2 XML", async () => {
		const xml = `<ListBucketResult>
			<CommonPrefixes><Prefix>edgewarden/daily/</Prefix></CommonPrefixes>
			<Contents>
				<Key>edgewarden/backup.zip</Key><Size>321</Size>
				<LastModified>2026-08-12T01:02:03.000Z</LastModified>
			</Contents>
			<Contents><Key>edgewarden/daily/ignored.zip</Key><Size>1</Size></Contents>
		</ListBucketResult>`;
		globalThis.fetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(xml, { status: 200 }));

		const result = await listS3Entries(config, "");

		expect(result.items).toEqual([
			{
				path: "daily",
				name: "daily",
				isDirectory: true,
				size: null,
				modifiedAt: null,
			},
			{
				path: "backup.zip",
				name: "backup.zip",
				isDirectory: false,
				size: 321,
				modifiedAt: "2026-08-12T01:02:03.000Z",
			},
		]);
		const request = vi.mocked(fetch).mock.calls[0]?.[0];
		expect(request).toBeInstanceOf(Request);
		const requestedUrl = new URL((request as Request).url);
		expect(requestedUrl.pathname).toBe("/backups");
		expect(requestedUrl.searchParams.get("list-type")).toBe("2");
		expect(requestedUrl.searchParams.get("prefix")).toBe("edgewarden/");
		expect((request as Request).signal).toBeInstanceOf(AbortSignal);
		expect((request as Request).headers.get("Authorization")).toMatch(
			/^AWS4-HMAC-SHA256 /,
		);
	});

	it("uploads to the encoded path-style object URL", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(null, { status: 200 }));
		globalThis.fetch = fetchMock;

		await putToS3(config, "folder/my backup.zip", new Uint8Array([1, 2]));

		expect(fetchMock).toHaveBeenCalledOnce();
		const request = fetchMock.mock.calls[0]?.[0];
		expect(request).toBeInstanceOf(Request);
		expect((request as Request).url).toBe(
			"https://s3.example.test/backups/edgewarden/folder/my%20backup.zip",
		);
		expect(request as Request).toMatchObject({
			method: "PUT",
			signal: expect.any(AbortSignal),
		});
		expect((request as Request).headers.get("Authorization")).toMatch(
			/^AWS4-HMAC-SHA256 /,
		);
	});

	it("rejects oversized backup downloads before buffering", async () => {
		globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(null, {
				status: 200,
				headers: {
					"content-length": String(MAX_BACKUP_ARCHIVE_BYTES + 1),
				},
			}),
		);
		await expect(downloadFromS3(config, "backup.zip")).rejects.toThrow(
			"S3 backup download exceeds",
		);
	});
});
