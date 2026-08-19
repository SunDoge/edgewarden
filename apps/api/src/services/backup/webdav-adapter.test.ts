import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebDavBackupDestination } from "./config";
import { MAX_BACKUP_ARCHIVE_BYTES } from "./limits";
import {
  downloadFromWebDav,
  listWebDavEntries,
  putToWebDav,
} from "./webdav-adapter";

const config: WebDavBackupDestination = {
  baseUrl: "https://example.test/dav",
  username: "backup-user",
  password: "backup-password",
  remotePath: "edgewarden",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("WebDAV backup adapter", () => {
  it("lists only direct children from a namespaced PROPFIND response", async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
			<d:multistatus xmlns:d="DAV:">
				<d:response><d:href>/dav/edgewarden/</d:href></d:response>
				<d:response>
					<d:href>/dav/edgewarden/backup.zip</d:href>
					<d:propstat><d:prop>
						<d:getcontentlength>123</d:getcontentlength>
						<d:getlastmodified>Wed, 12 Aug 2026 00:00:00 GMT</d:getlastmodified>
					</d:prop></d:propstat>
				</d:response>
				<d:response>
					<d:href>/dav/edgewarden/nested/ignored.zip</d:href>
				</d:response>
			</d:multistatus>`;
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(xml, { status: 207 }));

    const result = await listWebDavEntries(config, "");

    expect(result).toMatchObject({
      provider: "webdav",
      currentPath: "",
      parentPath: null,
      items: [
        {
          path: "backup.zip",
          name: "backup.zip",
          isDirectory: false,
          size: 123,
          modifiedAt: "2026-08-12T00:00:00.000Z",
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/dav/edgewarden",
      expect.objectContaining({
        method: "PROPFIND",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("selects successful propstat values across default namespaces", async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
			<multistatus xmlns="DAV:">
				<response><href>/dav/edgewarden/</href></response>
				<response>
					<href>/dav/edgewarden/Daily%20Backups/</href>
					<propstat>
						<prop><getcontentlength>999</getcontentlength></prop>
						<status>HTTP/1.1 404 Not Found</status>
					</propstat>
					<propstat>
						<prop>
							<resourcetype><collection/></resourcetype>
							<getlastmodified>Thu, 13 Aug 2026 01:02:03 GMT</getlastmodified>
						</prop>
						<status>HTTP/1.1 200 OK</status>
					</propstat>
				</response>
				<response>
					<href>/dav/edgewarden/backup&amp;copy.zip</href>
					<propstat><prop><getcontentlength>7</getcontentlength></prop></propstat>
				</response>
			</multistatus>`;
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(xml, { status: 207 }));

    const result = await listWebDavEntries(config, "");

    expect(result.items).toEqual([
      {
        path: "Daily Backups",
        name: "Daily Backups",
        isDirectory: true,
        size: null,
        modifiedAt: "2026-08-13T01:02:03.000Z",
      },
      {
        path: "backup&copy.zip",
        name: "backup&copy.zip",
        isDirectory: false,
        size: 7,
        modifiedAt: null,
      },
    ]);
  });

  it("rejects successful responses that are not WebDAV multistatus XML", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<html><body>OK</body></html>", { status: 207 }),
      );

    await expect(listWebDavEntries(config, "")).rejects.toThrow(
      "WebDAV listing returned invalid XML",
    );
  });

  it("normalizes malformed XML parser errors", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<multistatus><response></multistatus>", { status: 207 }),
      );

    await expect(listWebDavEntries(config, "")).rejects.toThrow(
      "WebDAV listing returned invalid XML",
    );
  });

  it("creates missing path segments before uploading a file", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock;

    await putToWebDav(config, "daily/backup.zip", new Uint8Array([1, 2, 3]), {
      contentType: "application/zip",
    });

    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([
      ["https://example.test/dav/edgewarden", "MKCOL"],
      ["https://example.test/dav/edgewarden/daily", "MKCOL"],
      ["https://example.test/dav/edgewarden/daily/backup.zip", "PUT"],
    ]);
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      "Content-Type": "application/zip",
      "Content-Length": "3",
    });
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => init?.signal instanceof AbortSignal,
      ),
    ).toBe(true);
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
    await expect(downloadFromWebDav(config, "backup.zip")).rejects.toThrow(
      "WebDAV backup download exceeds",
    );
  });
});
