import { describe, expect, it } from "vitest";
import { readDevLoginCredentials } from "./dev-login";

describe("development auto login", () => {
  it("is impossible outside Vite development mode", () => {
    expect(
      readDevLoginCredentials(false, {
        VITE_DEV_AUTO_LOGIN: "true",
        VITE_DEV_EMAIL: "dev@example.test",
        VITE_DEV_PASSWORD: "secret",
      }),
    ).toBeNull();
  });

  it("requires an explicit flag and complete credentials", () => {
    expect(readDevLoginCredentials(true, {})).toBeNull();
    expect(
      readDevLoginCredentials(true, {
        VITE_DEV_AUTO_LOGIN: "true",
        VITE_DEV_EMAIL: "dev@example.test",
      }),
    ).toBeNull();
    expect(
      readDevLoginCredentials(true, {
        VITE_DEV_AUTO_LOGIN: "true",
        VITE_DEV_EMAIL: " dev@example.test ",
        VITE_DEV_PASSWORD: "local password",
      }),
    ).toEqual({ email: "dev@example.test", password: "local password" });
  });
});
