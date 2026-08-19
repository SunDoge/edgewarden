import { describe, expect, it } from "vitest";
import {
  encodeSignalRInvocation,
  parseSignalRHandshake,
  SIGNALR_HANDSHAKE_ACK,
  SIGNALR_RECORD_SEPARATOR,
} from "./signalr";

describe("SignalR wire protocol", () => {
  it("accepts the protocols used by official Bitwarden clients", () => {
    expect(
      parseSignalRHandshake(
        `{"protocol":"messagepack","version":1}${SIGNALR_RECORD_SEPARATOR}`,
      ),
    ).toBe("messagepack");
    expect(
      parseSignalRHandshake(
        new TextEncoder().encode(
          `{"protocol":"json","version":1}${SIGNALR_RECORD_SEPARATOR}`,
        ),
      ),
    ).toBe("json");
    expect(parseSignalRHandshake("invalid")).toBeNull();
    expect(new TextDecoder().decode(SIGNALR_HANDSHAKE_ACK)).toBe(
      `{}${SIGNALR_RECORD_SEPARATOR}`,
    );
  });

  it("encodes JSON and length-prefixed MessagePack invocations", () => {
    const payload = { UserId: "user-id", Date: "2026-08-13T00:00:00.000Z" };
    const json = encodeSignalRInvocation("json", 5, payload);
    expect(typeof json).toBe("string");
    expect(JSON.parse(String(json).slice(0, -1))).toMatchObject({
      type: 1,
      target: "ReceiveMessage",
      arguments: [{ Type: 5, Payload: payload }],
    });
    const messagePack = encodeSignalRInvocation("messagepack", 5, payload);
    expect(messagePack).toBeInstanceOf(Uint8Array);
    const bytes = messagePack as Uint8Array;
    let length = 0;
    let shift = 0;
    let prefixLength = 0;
    for (const byte of bytes) {
      prefixLength += 1;
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    expect(length).toBe(bytes.length - prefixLength);
    expect(bytes[prefixLength]).toBe(0x96);
  });
});
