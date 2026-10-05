// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectorScript = readFileSync(
  resolve(process.cwd(), "static/webauthn-fallback-connector.js"),
  "utf8",
);

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function byteValues(value: BufferSource): number[] {
  const view =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Array.from(view);
}

function installPage(data: unknown) {
  document.body.innerHTML = `
    <div id="message" hidden></div>
    <input id="remember" type="checkbox" />
    <button id="webauthn-button" type="button"></button>
  `;
  window.history.replaceState(
    {},
    "",
    `/webauthn-fallback-connector.html?data=${encodeURIComponent(base64(data))}&v=1&btnText=Read%20security%20key&btnAwaitingInteractionText=Waiting...`,
  );
}

function credential() {
  return {
    id: "credential-id",
    rawId: bytes(1, 2, 3),
    type: "public-key",
    getClientExtensionResults: () => ({ appid: false }),
    response: {
      authenticatorData: bytes(4, 5),
      clientDataJSON: bytes(6, 7),
      signature: bytes(8, 9),
      userHandle: bytes(10),
    },
  };
}

describe("WebAuthn fallback connector", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it.each([
    ["direct options", (options: unknown) => options],
    [
      "Identity challenge wrapper",
      (options: unknown) => ({ Email: null, Challenge: { options } }),
    ],
  ])(
    "accepts %s and returns the Bitwarden extension message",
    async (_name, wrap) => {
      const options = {
        rpId: "ew.naiwa.dev",
        challenge: "AQID",
        allowCredentials: [
          {
            id: "BAUG",
            transports: ["internal", "hybrid"],
            type: "public-key",
          },
        ],
        userVerification: "required",
      };
      installPage(wrap(options));
      const get = vi.fn(async (_options: CredentialRequestOptions) =>
        credential(),
      );
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        value: { get },
      });
      const postMessage = vi
        .spyOn(window, "postMessage")
        .mockImplementation(() => undefined);

      // The test intentionally executes the repository-owned production artifact in jsdom.
      // biome-ignore lint/security/noGlobalEval: this is trusted local test data, not user input.
      window.eval(connectorScript);
      (document.getElementById("remember") as HTMLInputElement).checked = true;
      (document.getElementById("webauthn-button") as HTMLButtonElement).click();

      await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
      const request = get.mock.calls[0][0] as CredentialRequestOptions & {
        publicKey: PublicKeyCredentialRequestOptions;
      };
      expect(byteValues(request.publicKey.challenge)).toEqual([1, 2, 3]);
      expect(
        byteValues(
          request.publicKey.allowCredentials?.[0]?.id ?? new ArrayBuffer(0),
        ),
      ).toEqual([4, 5, 6]);

      const [result, targetOrigin] = postMessage.mock.calls[0] as [
        { command: string; data: string; remember: boolean },
        string,
      ];
      expect(targetOrigin).toBe("*");
      expect(result.command).toBe("webAuthnResult");
      expect(result.remember).toBe(true);
      expect(JSON.parse(result.data)).toEqual({
        id: "credential-id",
        rawId: "AQID",
        type: "public-key",
        extensions: { appid: false },
        response: {
          authenticatorData: "BAU",
          clientDataJson: "Bgc",
          signature: "CAk",
          userHandle: "Cg",
        },
      });
    },
  );

  it("rejects malformed challenge data without invoking an authenticator", async () => {
    installPage({ Challenge: { options: { rpId: "ew.naiwa.dev" } } });
    const get = vi.fn();
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get },
    });

    // The test intentionally executes the repository-owned production artifact in jsdom.
    // biome-ignore lint/security/noGlobalEval: this is trusted local test data, not user input.
    window.eval(connectorScript);
    (document.getElementById("webauthn-button") as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(document.getElementById("message")?.textContent).toContain(
        "Invalid WebAuthn challenge data",
      ),
    );
    expect(get).not.toHaveBeenCalled();
  });
});
