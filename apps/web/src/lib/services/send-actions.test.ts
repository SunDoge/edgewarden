import { describe, expect, it } from "vitest";
import { createSendEditorDraft } from "./send-editor";
import { validateSendDraft } from "./send-actions";

describe("Send action validation", () => {
  it("requires a name", () => {
    expect(() => validateSendDraft(createSendEditorDraft(), true)).toThrow(
      "名称不能为空",
    );
  });

  it("requires content for text Sends", () => {
    const form = { ...createSendEditorDraft(), name: "Secret" };
    expect(() => validateSendDraft(form, true)).toThrow("文本内容不能为空");
  });

  it("requires a file only when creating a file Send", () => {
    const form = { ...createSendEditorDraft(), type: 1, name: "Document" };
    expect(() => validateSendDraft(form, true)).toThrow("请选择要上传的文件");
    expect(() => validateSendDraft(form, false)).not.toThrow();
  });

  it("requires a new Send password when password protection is selected", () => {
    const form = {
      ...createSendEditorDraft(),
      name: "Secret",
      textContent: "content",
      protectWithPassword: true,
    };
    expect(() => validateSendDraft(form, true)).toThrow("必须输入访问密码");
  });
});
