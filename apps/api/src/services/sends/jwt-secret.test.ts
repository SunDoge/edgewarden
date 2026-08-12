import { describe, expect, it } from "vitest";
import { LIMITS } from "../../config";
import { getSafeSendJwtSecret } from "./jwt-secret";

function envWithSecret(secret: string): CloudflareBindings {
	return { JWT_SECRET: secret } as CloudflareBindings;
}

describe("send JWT secret", () => {
	it("rejects absent and undersized secrets", () => {
		expect(getSafeSendJwtSecret(envWithSecret(""))).toBeNull();
		expect(
			getSafeSendJwtSecret(
				envWithSecret("x".repeat(LIMITS.auth.jwtSecretMinLength - 1)),
			),
		).toBeNull();
	});

	it("trims and accepts a sufficiently long secret", () => {
		const secret = "x".repeat(LIMITS.auth.jwtSecretMinLength);
		expect(getSafeSendJwtSecret(envWithSecret(` ${secret} `))).toBe(secret);
	});
});
