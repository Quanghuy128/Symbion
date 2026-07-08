"use client";

import { useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";

export interface TemplateMarkdownViewerProps {
  content: string;
  /** imperative handle for the clipboard-failure select-all fallback. */
  selectAllRef?: React.MutableRefObject<(() => void) | null>;
}

/**
 * TemplateMarkdownViewer — read-only CodeMirror wrapper, reusing
 * MarkdownTab's `@codemirror/lang-markdown` extension list but in
 * non-editable mode (EditorView.editable.of(false) + EditorState.readOnly.of(true),
 * per templates-marketplace PLAN §1's exact note — no new editor dependency).
 * `theme="dark"` matches MarkdownTab's CodeMirror instance so both editors
 * stay visually consistent with the dark redesign (no separate/second theme).
 */
export function TemplateMarkdownViewer({ content, selectAllRef }: TemplateMarkdownViewerProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  if (selectAllRef) {
    selectAllRef.current = () => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      view.focus();
    };
  }

  return (
    <CodeMirror
      ref={cmRef}
      value={content}
      height="360px"
      theme="dark"
      extensions={[markdown(), EditorView.editable.of(false), EditorState.readOnly.of(true)]}
    />
  );
}
