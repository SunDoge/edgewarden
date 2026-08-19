import { describe, expect, it } from "vitest";
import { createSendEditorDraft, sendToEditorDraft } from "./send-editor";

describe("send editor draft", () => {
  it("creates safe defaults for a text Send", () => {
    expect(createSendEditorDraft()).toEqual({
      type: 0,
      name: "",
      notes: "",
      textContent: "",
      file: null,
      maxAccessCount: null,
      expirationDate: "",
      deletionDays: 7,
      password: "",
      protectWithPassword: false,
      hideEmail: false,
      disabled: false,
    });
  });

  it("maps an existing Send without carrying its password into the form", () => {
    const now = Date.parse("2026-08-12T00:00:00.000Z");
    const draft = sendToEditorDraft(
      {
        type: 0,
        name: "Secret",
        text: { text: "content" },
        password: "server-password-hash",
        hideEmail: true,
        disabled: true,
        deletionDate: "2026-08-19T00:00:00.000Z",
        expirationDate: "2026-08-13T09:30:00.000Z",
      },
      now,
    );

    expect(draft).toMatchObject({
      name: "Secret",
      textContent: "content",
      deletionDays: 7,
      expirationDate: "2026-08-13T09:30",
      password: "",
      protectWithPassword: true,
      hideEmail: true,
      disabled: true,
    });
  });

  it("clamps deletion choices to the supported range", () => {
    const now = Date.parse("2026-08-12T00:00:00.000Z");
    expect(
      sendToEditorDraft(
        { type: 1, name: "File", deletionDate: "2027-08-12T00:00:00Z" },
        now,
      ).deletionDays,
    ).toBe(30);
  });
});
