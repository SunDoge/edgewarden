import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  type BaseIssue,
  type BaseSchema,
  type InferInput,
  type InferOutput,
  safeParse,
} from "valibot";
import type { HonoEnv } from "../env";
import { RevocationSchema, TokenFormSchema } from "../schemas/identity";
import { identityErrorResponse } from "../utils/response";

type ValidatedForm<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> = {
  in: { form: InferInput<TSchema> };
  out: { form: InferOutput<TSchema> };
};

async function readJsonOrForm(c: Context<HonoEnv>) {
  try {
    if ((c.req.header("content-type") ?? "").includes("application/json")) {
      return await c.req.json();
    }
    const form = await c.req.formData();
    return Object.fromEntries(
      Array.from(form.entries()).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return null;
  }
}

async function validateRequest<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(
  c: Context<HonoEnv>,
  schema: TSchema,
): Promise<InferOutput<TSchema> | Response> {
  const raw = await readJsonOrForm(c);
  const result = safeParse(schema, raw);
  if (!result.success) {
    return identityErrorResponse(
      "Invalid request payload",
      "invalid_request",
      400,
    );
  }
  return result.output;
}

export const tokenRequestValidator = createMiddleware<
  HonoEnv,
  string,
  ValidatedForm<typeof TokenFormSchema>
>(async (c, next) => {
  const body = await validateRequest(c, TokenFormSchema);
  if (body instanceof Response) return body;
  c.set("tokenRequest", body);
  await next();
});

export const revocationRequestValidator = createMiddleware<
  HonoEnv,
  string,
  ValidatedForm<typeof RevocationSchema>
>(async (c, next) => {
  const body = await validateRequest(c, RevocationSchema);
  if (body instanceof Response) return body;
  c.set("revocationToken", body.token);
  await next();
});
