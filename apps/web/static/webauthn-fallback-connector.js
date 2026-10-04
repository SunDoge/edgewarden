(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const button = document.getElementById("webauthn-button");
  const remember = document.getElementById("remember");
  const message = document.getElementById("message");

  function showMessage(text, success = false) {
    message.textContent = text instanceof Error ? text.message : String(text);
    message.classList.toggle("success", success);
    message.hidden = false;
  }

  function decodeBase64Utf8(value) {
    const binary = atob(value.replace(/ /g, "+"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  }

  function bytesToBase64Url(value) {
    let binary = "";
    for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  // Bitwarden clients have used both a direct PublicKeyCredentialRequestOptions
  // payload and an Identity API wrapper containing Challenge.options.
  function parseRequestOptions() {
    const encoded = params.get("data");
    if (!encoded) throw new Error("Missing WebAuthn challenge data.");
    let value = JSON.parse(decodeBase64Utf8(encoded));
    if (typeof value === "string") value = JSON.parse(value);
    const options =
      value?.Challenge?.options ??
      value?.challenge?.options ??
      value?.options ??
      value?.data ??
      value;
    if (!options || typeof options !== "object" || typeof options.challenge !== "string") {
      throw new Error("Invalid WebAuthn challenge data.");
    }
    options.challenge = base64UrlToBytes(options.challenge);
    if (Array.isArray(options.allowCredentials)) {
      options.allowCredentials = options.allowCredentials.map((credential) => ({
        ...credential,
        id: base64UrlToBytes(credential.id),
      }));
    }
    return options;
  }

  function serializeCredential(credential) {
    const response = credential.response;
    return JSON.stringify({
      id: credential.id,
      rawId: bytesToBase64Url(credential.rawId),
      type: credential.type,
      extensions: credential.getClientExtensionResults(),
      response: {
        authenticatorData: bytesToBase64Url(response.authenticatorData),
        clientDataJson: bytesToBase64Url(response.clientDataJSON),
        signature: bytesToBase64Url(response.signature),
        ...(response.userHandle ? { userHandle: bytesToBase64Url(response.userHandle) } : {}),
      },
    });
  }

  async function authenticate() {
    if (!navigator.credentials) {
      showMessage("WebAuthn is not supported in this browser.");
      return;
    }
    button.disabled = true;
    button.textContent = decodeURIComponent(
      params.get("btnAwaitingInteractionText") || "Awaiting security key interaction...",
    );
    try {
      const credential = await navigator.credentials.get({ publicKey: parseRequestOptions() });
      if (!credential) throw new Error("No credential was returned.");
      window.postMessage(
        {
          command: "webAuthnResult",
          data: serializeCredential(credential),
          remember: remember.checked,
        },
        "*",
      );
      showMessage("Security key verified. You can close this tab.", true);
      button.textContent = "Verified";
    } catch (error) {
      showMessage(error);
      button.disabled = false;
      button.textContent = decodeURIComponent(params.get("btnText") || "Read security key");
    }
  }

  button.textContent = decodeURIComponent(params.get("btnText") || "Read security key");
  button.addEventListener("click", authenticate);
})();
