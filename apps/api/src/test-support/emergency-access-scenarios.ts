import assert from "node:assert/strict";
import { test } from "vitest";

interface Context {
  readonly database: D1Database;
  readonly accessToken: string;
  readonly memberAccessToken: string;
  readonly memberEmail: string;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export function registerEmergencyAccessScenarios(context: Context): void {
  test("runs zero-knowledge emergency access through confirmation and its wait deadline", async () => {
    const grantorAuth = {
      authorization: `Bearer ${context.accessToken}`,
      "content-type": "application/json",
    };
    const granteeAuth = {
      authorization: `Bearer ${context.memberAccessToken}`,
      "content-type": "application/json",
    };
    const invite = await context.request("/api/emergency-access/invite", {
      method: "POST",
      headers: grantorAuth,
      body: JSON.stringify({
        email: context.memberEmail,
        type: 0,
        waitTimeDays: 1,
      }),
    });
    assert.equal(invite.status, 200, await invite.text());
    const trustedResponse = await context.request(
      "/api/emergency-access/trusted",
      { headers: grantorAuth },
    );
    const trusted = (await trustedResponse.json()) as {
      data: Array<{ id: string; status: number }>;
    };
    assert.equal(trusted.data[0].status, 1);
    const id = trusted.data[0].id;
    const details = await context.request(`/api/emergency-access/${id}`, {
      headers: grantorAuth,
    });
    assert.equal(details.status, 200, await details.clone().text());
    const detailBody = await details.json<{
      id: string;
      granteeId: string;
      email: string;
      status: number;
      type: number;
      waitTimeDays: number;
      object: string;
    }>();
    assert.equal(detailBody.id, id);
    assert.ok(detailBody.granteeId);
    assert.equal(detailBody.email, context.memberEmail);
    assert.equal(detailBody.status, 1);
    assert.equal(detailBody.type, 0);
    assert.equal(detailBody.waitTimeDays, 1);
    assert.equal(detailBody.object, "emergencyAccessGranteeDetails");
    for (const obsolete of [
      `/api/emergency-access/${id}`,
      `/api/emergency-access/${id}/delete`,
    ]) {
      const response = await context.request(obsolete, {
        method: "POST",
        headers: grantorAuth,
        body: JSON.stringify({ type: 0, waitTimeDays: 1 }),
      });
      assert.equal(response.status, 404);
    }
    const confirm = await context.request(
      `/api/emergency-access/${id}/confirm`,
      {
        method: "POST",
        headers: grantorAuth,
        body: JSON.stringify({ key: "4.client-encrypted-user-key" }),
      },
    );
    assert.equal(confirm.status, 200, await confirm.text());
    const initiate = await context.request(
      `/api/emergency-access/${id}/initiate`,
      { method: "POST", headers: granteeAuth },
    );
    assert.equal(initiate.status, 200, await initiate.text());
    const denied = await context.request(`/api/emergency-access/${id}/view`, {
      method: "POST",
      headers: granteeAuth,
    });
    assert.equal(denied.status, 403);
    await context.database
      .prepare(
        "UPDATE emergency_access SET recovery_initiated_at = ? WHERE id = ?",
      )
      .bind(Math.floor(Date.now() / 1000) - 86_401, id)
      .run();
    const view = await context.request(`/api/emergency-access/${id}/view`, {
      method: "POST",
      headers: granteeAuth,
    });
    const viewText = await view.text();
    assert.equal(view.status, 200, viewText);
    const payload = JSON.parse(viewText) as {
      keyEncrypted: string;
      ciphers: unknown[];
    };
    assert.equal(payload.keyEncrypted, "4.client-encrypted-user-key");
    assert.ok(Array.isArray(payload.ciphers));
    const missingAttachment = await context.request(
      `/api/emergency-access/${id}/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}`,
      { headers: granteeAuth },
    );
    assert.equal(missingAttachment.status, 404);
    const remove = await context.request(`/api/emergency-access/${id}`, {
      method: "DELETE",
      headers: grantorAuth,
    });
    assert.equal(remove.status, 200, await remove.text());
  });
}
