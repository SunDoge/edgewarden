import { describe, expect, it } from "vitest";
import { createSendEditorDraft } from "./send-editor";
import { validateSendDraft } from "./send-actions";

describe("Send action validation", () => {
  it("requires a name", () => {
    expect(() => validateSendDraft(createSendEditorDraft(), true)).toThrow(
      "Name is required",
    );
  });

  it("requires content for text Sends", () => {
    const form = { ...createSendEditorDraft(), name: "Secret" };
    expect(() => validateSendDraft(form, true)).toThrow(
      "Text content is required",
    );
  });

  it("requires a file only when creating a file Send", () => {
    const form = { ...createSendEditorDraft(), type: 1, name: "Document" };
    expect(() => validateSendDraft(form, true)).toThrow(
      "Select a file to upload",
    );
    expect(() => validateSendDraft(form, false)).not.toThrow();
  });

  it("requires a new Send password when password protection is selected", () => {
    const form = {
      ...createSendEditorDraft(),
      name: "Secret",
      textContent: "content",
      protectWithPassword: true,
    };
    expect(() => validateSendDraft(form, true)).toThrow(
      "Enter an access password",
    );
  });
});
