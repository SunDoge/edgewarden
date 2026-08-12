import { describe, expect, it } from "vitest";
import {
	buildJoinedPath,
	extractXmlBlocks,
	extractXmlFirst,
	normalizeRelativePath,
	parentPath,
	sortRemoteItems,
} from "./remote-utils";

describe("remote backup paths", () => {
	it("normalizes and joins relative paths", () => {
		expect(normalizeRelativePath("/folder\\child/file.zip/")).toBe(
			"folder/child/file.zip",
		);
		expect(buildJoinedPath("/root/", "/child", "file.zip")).toBe(
			"root/child/file.zip",
		);
		expect(parentPath("folder/file.zip")).toBe("folder");
		expect(parentPath("file.zip")).toBe("");
	});

	it.each(["../secret", "folder/./file", "folder/../file"])(
		"rejects traversal path %s",
		(path) => expect(() => normalizeRelativePath(path)).toThrow(),
	);
});

describe("remote backup responses", () => {
	it("extracts namespaced XML blocks and decodes entities", () => {
		const xml = "<d:response><d:href>/a&amp;b</d:href></d:response>";
		expect(extractXmlBlocks(xml, "response")).toHaveLength(1);
		expect(extractXmlFirst(xml, "href")).toBe("/a&b");
	});

	it("sorts the attachment directory before other directories and files", () => {
		const items = [
			{ name: "z.zip", isDirectory: false },
			{ name: "folder", isDirectory: true },
			{ name: "attachments", isDirectory: true },
		];
		expect(sortRemoteItems(items).map((item) => item.name)).toEqual([
			"attachments",
			"folder",
			"z.zip",
		]);
	});
});
