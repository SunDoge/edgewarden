import { createFactory } from "hono/factory";
import type { HonoEnv } from "../env";

export const factory = createFactory<HonoEnv>();
