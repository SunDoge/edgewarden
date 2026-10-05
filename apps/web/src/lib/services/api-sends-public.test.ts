import { afterEach, describe, expect, it, vi } from "vitest";
import { accessSendPublicApi, requestSendFileDownloadApi } from "./api-sends";

const publicSend = {
  id: "send-id",
  type: 0,
  name: "encrypted-name",
  text: { text: "encrypted-text" },
  file: null,
  expirationDate: null,
  deletionDate: null,
  creatorIdentifier: null,
  object: "send-access",
};

afterEach(() => vi.unstubAllGlobals());

describe("current Send access protocol", () => {
  it("exchanges the access id and password hash for a scoped token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "send-token", token_type: "Bearer" }),
      )
      .mockResolvedValueOnce(Response.json(publicSend));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      accessSendPublicApi("access-id", { passwordHash: "password-hash" }),
    ).resolves.toEqual({ send: publicSend, accessToken: "send-token" });

    const tokenRequest = fetchMock.mock.calls[0];
    expect(tokenRequest[0]).toBe("/identity/connect/token");
    const tokenInit = tokenRequest[1] as RequestInit;
    expect(tokenInit.method).toBe("POST");
    expect(Object.fromEntries(tokenInit.body as URLSearchParams)).toMatchObject(
      {
        grant_type: "send_access",
        client_id: "send",
        scope: "api.send.access",
        send_id: "access-id",
        password_hash_b64: "password-hash",
      },
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/sends/access",
      {
        method: "POST",
        headers: { authorization: "Bearer send-token" },
      },
    ]);
  });

  it("maps token password challenges to the public page password state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: "invalid_grant",
            error_description: "Password required.",
            send_access_error_type: "password_hash_b64_required",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(accessSendPublicApi("access-id")).rejects.toMatchObject({
      status: 401,
      message: "Password required.",
    });
  });

  it("requests file tickets with the scoped Send token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ url: "/signed-download" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestSendFileDownloadApi("send-token", "file-id"),
    ).resolves.toEqual({ url: "/signed-download" });
    expect(fetchMock).toHaveBeenCalledWith("/api/sends/access/file/file-id", {
      method: "POST",
      headers: { authorization: "Bearer send-token" },
    });
  });
});
