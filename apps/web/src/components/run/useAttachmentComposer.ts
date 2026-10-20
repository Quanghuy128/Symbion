"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from "react";
import { RUN_ATTACHMENT_LIMITS, formatAttachmentBytes, type RunAttachmentMediaType } from "@symbion/core";
import { NotAnImageError, encodeImageFile } from "@/lib/run/attachments";

export interface AttachmentChip {
  id: string;
  name: string;
  size: number;
  status: "encoding" | "ready";
  mediaType?: RunAttachmentMediaType;
  sha256?: string;
  data?: string;
  previewUrl?: string;
}

export const WSL_CLIPBOARD_HINT =
  "Your clipboard has an image the browser can't read (common on WSL). Drag the file in or use Attach image.";

const MiB = 1024 * 1024;
const mb = (n: number): string => formatAttachmentBytes(n);

/**
 * useAttachmentComposer — paste / drag-drop / picker handling for the Run dialog.
 * Sequential async per file (never blocks typing); every rejection is a visible
 * message, never a silent drop. Limits come from core (single source with the daemon).
 */
export function useAttachmentComposer(opts: { supported: boolean; unsupportedReason?: string }) {
  const { supported, unsupportedReason } = opts;
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // Synchronous mirror used for count/total accounting across overlapping addFiles calls.
  const chipsRef = useRef<AttachmentChip[]>([]);
  const idSeq = useRef(0);
  const mounted = useRef(true);

  const commit = useCallback((next: AttachmentChip[]) => {
    chipsRef.current = next;
    if (mounted.current) setChips(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const c of chipsRef.current) if (c.previewUrl) URL.revokeObjectURL(c.previewUrl);
    };
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (!supported) {
        setHint(unsupportedReason ?? "This claude CLI can't receive images.");
        return;
      }
      setHint(null);
      const batchErrors: string[] = [];
      for (const file of files) {
        const L = RUN_ATTACHMENT_LIMITS;
        const cur = chipsRef.current;
        const total = cur.reduce((n, c) => n + c.size, 0);
        if (file.size === 0) {
          batchErrors.push(`${file.name}: empty file`);
          continue;
        }
        if (cur.length >= L.maxCount) {
          batchErrors.push(`Only ${L.maxCount} images per run`);
          continue;
        }
        if (file.size > L.maxBytesEach) {
          batchErrors.push(`${file.name}: ${mb(file.size)} — the limit is ${L.maxBytesEach / MiB} MB per image`);
          continue;
        }
        if (total + file.size > L.maxBytesTotal) {
          batchErrors.push(`Adding ${file.name} would exceed ${L.maxBytesTotal / MiB} MB total`);
          continue;
        }
        const id = `att-${++idSeq.current}`;
        commit([...cur, { id, name: file.name, size: file.size, status: "encoding" }]);
        try {
          const enc = await encodeImageFile(file);
          if (!chipsRef.current.some((c) => c.id === id)) {
            // removed / unmounted while encoding
            URL.revokeObjectURL(enc.previewUrl);
            continue;
          }
          commit(
            chipsRef.current.map((c) =>
              c.id === id
                ? {
                    id,
                    name: enc.name,
                    size: enc.size,
                    status: "ready" as const,
                    mediaType: enc.mediaType,
                    sha256: enc.sha256,
                    data: enc.data,
                    previewUrl: enc.previewUrl,
                  }
                : c
            )
          );
        } catch (err) {
          commit(chipsRef.current.filter((c) => c.id !== id));
          batchErrors.push(
            err instanceof NotAnImageError
              ? `${file.name}: not a supported image (PNG, JPEG, GIF, WebP)`
              : `${file.name}: could not be read`
          );
        }
      }
      if (mounted.current) setErrors(batchErrors);
    },
    [commit, supported, unsupportedReason]
  );

  const remove = useCallback(
    (id: string) => {
      const gone = chipsRef.current.find((c) => c.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      commit(chipsRef.current.filter((c) => c.id !== id));
      setErrors([]);
      setHint(null);
    },
    [commit]
  );

  /** React onPaste — files win; an image type with no file (WSL2/WSLg) shows the hint; text falls through. */
  const onPaste = useCallback(
    (e: ReactClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const items = Array.from(cd.items ?? []);
      // `files` and `items[].getAsFile()` describe the SAME clipboard image, but Chromium
      // returns a distinct File object from each (so identity de-dupe doesn't work) — use
      // `files`, and fall back to `items` only when `files` is empty.
      let files: File[] = Array.from(cd.files ?? []);
      if (files.length === 0) {
        files = items.flatMap((it) => {
          const f = it.kind === "file" ? it.getAsFile() : null;
          return f ? [f] : [];
        });
      }
      // Mixed clipboard (Excel/Word: text + a rendered image): keep the default text
      // paste and attach nothing — matches the Claude Code extension (image-only
      // items attach; anything with usable text is a normal text paste).
      if (items.some((it) => it.kind === "string" && it.type === "text/plain") || (cd.getData?.("text/plain") ?? "").length > 0) {
        return;
      }
      if (files.length > 0) {
        e.preventDefault();
        void addFiles(files);
        return;
      }
      if (items.some((it) => typeof it.type === "string" && it.type.startsWith("image/"))) {
        e.preventDefault();
        setHint(supported ? WSL_CLIPBOARD_HINT : (unsupportedReason ?? "This claude CLI can't receive images."));
      }
    },
    [addFiles, supported, unsupportedReason]
  );

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      setDragging(false);
      dragDepth.current = 0;
      void addFiles(Array.from(e.dataTransfer?.files ?? []));
    },
    [addFiles]
  );

  // --- drop overlay + the window guard (a stray drop must never navigate the tab) ---
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const encoding = chips.some((c) => c.status === "encoding");
  const ready = chips.filter((c) => c.status === "ready");
  /** identity of the settled image set ("" = none) — what a consent nonce must be bound to. */
  const signature = encoding ? null : ready.map((c) => `${c.sha256}:${c.size}:${c.mediaType}`).join("|");
  const totalBytes = chips.reduce((n, c) => n + c.size, 0);

  /** metadata for runPreflight (no bytes). */
  const getPreflightAttachments = useCallback(
    () =>
      chipsRef.current
        .filter((c) => c.status === "ready")
        .map((c) => ({ sha256: c.sha256!, size: c.size, mediaType: c.mediaType! })),
    []
  );
  /** bytes for startRun. */
  const getSendAttachments = useCallback(
    () =>
      chipsRef.current
        .filter((c) => c.status === "ready")
        .map((c) => ({ name: c.name, mediaType: c.mediaType!, data: c.data! })),
    []
  );

  return {
    chips,
    errors,
    hint,
    dragging,
    encoding,
    signature,
    totalBytes,
    addFiles,
    remove,
    onPaste,
    onDrop,
    getPreflightAttachments,
    getSendAttachments,
  };
}
