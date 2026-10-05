import { describe, expect, it } from "vitest";
import {
  type SendPasswordFields,
  setSendPassword,
  verifySendPassword,
} from "./password";

describe("send passwords", () => {
  it("derives and verifies a password without storing the plaintext", async () => {
    const send: SendPasswordFields = { auth_type: 2 };

    await setSendPassword(send, "correct horse battery staple");

    expect(send.password_hash).toBeTruthy();
    expect(send.password_salt).toBeTruthy();
    expect(send.password_algorithm).toBe("pbkdf2-sha256");
    expect(send.password_iterations).toBe(100000);
    expect(send).not.toHaveProperty("password");
    expect(await verifySendPassword(send, "correct horse battery staple")).toBe(
      true,
    );
    expect(await verifySendPassword(send, "wrong password")).toBe(false);
  });

  it("clears all password metadata", async () => {
    const send: SendPasswordFields = { auth_type: 1 };
    await setSendPassword(send, "secret");
    await setSendPassword(send, null);

    expect(send).toMatchObject({
      password_hash: null,
      password_salt: null,
      password_iterations: null,
      password_algorithm: null,
      auth_type: 2,
    });
  });

  it("rejects incomplete password metadata instead of using a legacy fallback", async () => {
    expect(
      await verifySendPassword({ password_hash: "invalid!" }, "invalid!"),
    ).toBe(false);
  });

  it.each([
    ["wrong auth type", { auth_type: 2 }],
    ["unsupported algorithm", { password_algorithm: "argon2id" }],
    ["unexpected iteration count", { password_iterations: 1 }],
    ["short salt", { password_salt: "AQID" }],
    ["short hash", { password_hash: "AQID" }],
  ])("rejects %s without attempting a legacy format", async (_name, patch) => {
    const send: SendPasswordFields = {};
    await setSendPassword(send, "secret");

    expect(await verifySendPassword({ ...send, ...patch }, "secret")).toBe(
      false,
    );
  });
});
