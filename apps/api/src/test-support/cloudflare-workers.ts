/** Node-test implementation of the platform base class. Worker-runtime tests use the real module. */
export abstract class DurableObject<Env = Cloudflare.Env> {
	protected readonly ctx: DurableObjectState;
	protected readonly env: Env;

	constructor(ctx: DurableObjectState, env: Env) {
		this.ctx = ctx;
		this.env = env;
	}
}
