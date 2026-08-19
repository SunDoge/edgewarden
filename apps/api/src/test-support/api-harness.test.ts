import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createApiTestHarness,
  expectJson,
  type ApiTestHarness,
} from "./api-harness";

describe("API test harness", () => {
  let harness: ApiTestHarness;

  beforeAll(async () => {
    harness = await createApiTestHarness({
      adminPassword: "test-admin-password",
      jwtSecret: "test-jwt-secret-with-sufficient-entropy",
      dataEncryptionSecret: "test-data-secret-with-sufficient-entropy",
    });
  });

  afterAll(async () => harness.dispose());

  test("sends JSON requests without repeating headers and serialization", async () => {
    const response = await harness.json("/identity/accounts/prelogin", {
      email: "missing@example.com",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("adds bearer authorization through a scoped client", async () => {
    const response = await harness
      .authenticated("invalid-test-token")
      .request("/api/sync");
    expect(response.status).toBe(401);
  });

  test("returns typed JSON and useful status failures", async () => {
    const config = await expectJson<{ object: string }>(
      await harness.request("/api/config"),
    );
    expect(config.object).toBe("config");

    await expect(
      expectJson(Response.json({ message: "denied" }, { status: 403 })),
    ).rejects.toThrow("received 403");
  });
});
