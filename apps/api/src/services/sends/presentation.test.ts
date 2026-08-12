import { describe, expect, it } from "vitest";
import { fromAccessId, toAccessId } from "./presentation";

describe("send access IDs", () => {
	it("round trips UUIDs through Bitwarden-compatible access IDs", () => {
		const id = "550e8400-e29b-41d4-a716-446655440000";
		const accessId = toAccessId(id);

		expect(accessId).toBe("VQ6EAOKbQdSnFkRmVUQAAA");
		expect(fromAccessId(accessId)).toBe(id);
	});

	it("rejects malformed IDs", () => {
		expect(toAccessId("not-a-uuid")).toBe("");
		expect(fromAccessId("not-base64!")).toBeNull();
	});
});
