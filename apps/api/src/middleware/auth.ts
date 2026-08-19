import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env";
import { verifyAccessToken } from "../services/auth";
import { errorResponse } from "../utils/response";

export const authMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const db = c.get("db");
  const secret = c.env.JWT_SECRET;
  const ctx = await verifyAccessToken(
    c.req.header("Authorization") ?? null,
    db,
    secret,
  );
  if (!ctx) {
    return new Response(
      JSON.stringify({ message: "Unauthorized", Object: "error" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  c.set("user", ctx.user);
  c.set("payload", ctx.payload);
  await next();
};

export const requireAdmin = createMiddleware<HonoEnv>(async (c, next) => {
  if (c.get("user").role !== "admin") {
    return errorResponse("Forbidden: Admins only", 403);
  }
  await next();
});
