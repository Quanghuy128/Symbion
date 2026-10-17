import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

/**
 * Symbion editor theme — built ONLY from design-system CSS variables
 * (docs/design-system/tokens.json via globals.css), so it follows the token
 * layer and contains no colour literals. Used by every CodeMirror instance
 * (MarkdownTab, TemplateMarkdownViewer).
 */
export const editorThemeSpec = {
  "&": {
    color: "var(--ink-2)",
    backgroundColor: "var(--bg-sidebar)",
    fontSize: "13px",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    lineHeight: "20px",
    caretColor: "var(--ink)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-sidebar)",
    color: "var(--ink-faint)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--surface-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--surface-hover)", color: "var(--ink-muted)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--mint-soft)",
  },
  "&.cm-focused": { outline: "2px solid var(--focus-ring)", outlineOffset: "2px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
} as const;

export const editorHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--ink)", fontWeight: "600" },
  { tag: tags.contentSeparator, color: "var(--workflow)" },
  { tag: [tags.string, tags.url, tags.link], color: "var(--mint-text)" },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--agent)" },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: "var(--ink-muted)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
]);

export const symbionEditorTheme: Extension[] = [
  EditorView.theme(editorThemeSpec, { dark: true }),
  syntaxHighlighting(editorHighlight),
];
