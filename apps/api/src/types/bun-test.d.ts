declare module "bun:test" {
	export function describe(name: string, run: () => void): void;
	export function test(
		name: string,
		run: () => unknown | Promise<unknown>,
	): void;
	export function beforeAll(run: () => unknown | Promise<unknown>): void;
	export function afterAll(run: () => unknown | Promise<unknown>): void;
}
