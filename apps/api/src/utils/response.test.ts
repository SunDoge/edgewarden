import { describe, expect, it } from "vitest";
import { withErrorResponse } from "./response";

describe("withErrorResponse", () => {
	it("returns successful operation results unchanged", async () => {
		const expected = new Response(null, { status: 204 });

		expect(await withErrorResponse(async () => expected, "failed")).toBe(
			expected,
		);
	});

	it("preserves Error messages and the route status", async () => {
		const response = await withErrorResponse(
			async () => {
				throw new Error("Detailed failure");
			},
			"Fallback failure",
			502,
		);

		expect(response).toBeInstanceOf(Response);
		if (!(response instanceof Response)) return;
		expect(response.status).toBe(502);
		expect(await response.json()).toMatchObject({
			message: "Detailed failure",
		});
	});

	it("does not expose non-Error rejection values", async () => {
		const response = await withErrorResponse(async () => {
			throw "secret rejection value";
		}, "Fallback failure");

		expect(response).toBeInstanceOf(Response);
		if (!(response instanceof Response)) return;
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			message: "Fallback failure",
		});
	});
});
