import { describe, expect, it } from "vitest";
import { formatTime } from "./format";

describe("localized formatting", () => {
	it("formats vault timestamps with the requested locale", () => {
		const value = new Date(2026, 0, 2, 9, 5);
		expect(formatTime(value, "zh-CN")).toMatch(/09:05/);
	});
});
