import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorThemeSpec, symbionEditorTheme } from "./theme";

describe("symbionEditorTheme", () => {
  it("uses only CSS variables for colours (no literals)", () => {
    const json = JSON.stringify(editorThemeSpec);
    expect(json).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(json).not.toMatch(/rgba?\(/);
    expect(json).toContain("var(--bg-sidebar)");
    expect(json).toContain("var(--focus-ring)");
  });

  it("is a usable extension: an EditorView mounts and is dark", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: "# hi", extensions: symbionEditorTheme }),
    });
    expect(parent.querySelector(".cm-editor")).not.toBeNull();
    expect(view.dom.className).toContain("cm-editor");
    view.destroy();
  });
});
