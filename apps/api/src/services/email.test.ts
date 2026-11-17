import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { WorkerBindings } from "../worker-bindings";
import { emergencyAccessEmail } from "./emergency-access-email";
import {
  DEFAULT_EMAIL_SETTINGS,
  sendTransactionalEmail,
  type RuntimeEmailSettings,
} from "./email";
import { invitationEmail } from "./invitation-email";

const message = {
  to: "member@example.test",
  subject: "Emergency access",
  text: "Plain text",
  html: "<p>Plain text</p>",
  tag: "emergency-access",
};

const runtime = (
  values: Partial<RuntimeEmailSettings>,
): RuntimeEmailSettings => ({
  ...DEFAULT_EMAIL_SETTINGS,
  activeProvider: null,
  environmentOverrides: [],
  ...values,
});

describe("transactional email", () => {
  test("keeps emergency access details private by default", () => {
    const email = emergencyAccessEmail({
      event: "takeover",
      to: "owner@example.test",
      actorName: "Trusted Person",
      actorEmail: "trusted@example.test",
      requestUrl: "https://vault.example.test/api/emergency-access/1",
    });
    assert.equal(email.subject, "Edgewarden security notification");
    assert.doesNotMatch(email.text, /takeover|Trusted Person|trusted@example/);
  });

  test("puts invitation credentials in a URL fragment", () => {
    const email = invitationEmail({
      to: "member@example.test",
      inviteLink: "https://vault.example.test/register#invite=secret",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const link = email.text.match(/https:\/\/\S+/)?.[0];
    assert.ok(link);
    assert.equal(new URL(link).search, "");
    assert.equal(new URL(link).hash, "#invite=secret");
  });

  test("stays disabled without a sender", async () => {
    const env = {} as WorkerBindings;
    assert.equal(await sendTransactionalEmail(env, runtime({}), message), null);
  });

  test("uses the native Cloudflare binding when available", async () => {
    let payload: unknown;
    const env = {
      EMAIL_FROM: "Edgewarden <vault@example.test>",
      EMAIL: {
        send: async (value: unknown) => {
          payload = value;
          return { messageId: "cf-message" };
        },
      },
    } as unknown as WorkerBindings;
    assert.deepEqual(
      await sendTransactionalEmail(
        env,
        runtime({
          enabled: true,
          from: "Edgewarden <vault@example.test>",
          activeProvider: "cloudflare",
        }),
        message,
      ),
      {
        provider: "cloudflare",
        messageId: "cf-message",
      },
    );
    assert.equal((payload as { to: string }).to, message.to);
  });

  test("uses Resend when explicitly selected", async () => {
    let authorization: string | null = null;
    const env = {
      EMAIL_PROVIDER: "resend",
      EMAIL_FROM: "vault@example.test",
      RESEND_API_KEY: "test-key",
    } as WorkerBindings;
    const result = await sendTransactionalEmail(
      env,
      runtime({
        enabled: true,
        provider: "resend",
        from: "vault@example.test",
        resendApiKey: "test-key",
        activeProvider: "resend",
      }),
      message,
      async (input, init) => {
        authorization = new Request(input, init).headers.get("authorization");
        return Response.json({ id: "resend-message" });
      },
    );
    assert.equal(authorization, "Bearer test-key");
    assert.deepEqual(result, {
      provider: "resend",
      messageId: "resend-message",
    });
  });
});
