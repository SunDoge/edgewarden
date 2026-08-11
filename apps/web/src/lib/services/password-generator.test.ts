import { describe, expect, it } from "vitest";
import { estimateBits, generateEmailAlias, generatePassphrase, generatePassword, generatePin, generateUsername } from "./password-generator";

describe("password generator", () => {
	it("honors length and required character groups", () => {
		const value = generatePassword({ length: 32, uppercase: true, lowercase: true, numbers: true, special: true, avoidAmbiguous: false, minUppercase: 3, minLowercase: 4, minNumbers: 5, minSpecial: 6 });
		expect(value).toHaveLength(32);
		expect(value).toMatch(/[A-Z]/);
		expect(value).toMatch(/[a-z]/);
		expect(value).toMatch(/\d/);
		expect(value).toMatch(/[^A-Za-z0-9]/);
		expect(value.match(/[A-Z]/g)?.length).toBeGreaterThanOrEqual(3);
		expect(value.match(/[a-z]/g)?.length).toBeGreaterThanOrEqual(4);
		expect(value.match(/\d/g)?.length).toBeGreaterThanOrEqual(5);
		expect(value.match(/[^A-Za-z0-9]/g)?.length).toBeGreaterThanOrEqual(6);
	});

	it("generates bounded PIN and passphrase values", () => {
		expect(generatePin(8)).toMatch(/^\d{8}$/);
		expect(generatePassphrase({ words: 5, separator: "-", capitalize: false, includeNumber: false }).split("-")).toHaveLength(5);
	});

	it("generates plus-addressed aliases and estimates entropy", () => {
		expect(generateEmailAlias({ email: "me@example.com", mode: "plus" })).toMatch(/^me\+.+@example\.com$/);
		expect(estimateBits("correct-horse-battery-staple", "passphrase")).toBeGreaterThan(20);
	});

	it("supports single-word usernames", () => {
		expect(generateUsername({ words: 1, separator: "-", capitalize: false, includeNumber: false })).not.toContain("-");
	});

	it("supports custom passphrase and username word lists", () => {
		expect(generatePassphrase({ words: 3, separator: "-", capitalize: false, includeNumber: false, customWords: "alpha beta" })).toMatch(/^(alpha|beta)-(alpha|beta)-(alpha|beta)$/);
		expect(generateUsername({ words: 1, separator: ".", capitalize: false, includeNumber: false, customWords: "north south", customWord: "team" })).toMatch(/^team\.(north|south)$/);
		expect(() => generatePassphrase({ words: 3, separator: "-", capitalize: false, includeNumber: false, customWords: "only" })).toThrow();
	});
});
