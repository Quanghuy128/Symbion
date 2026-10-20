"use client";

import { useEffect, useState } from "react";
import { formatAttachmentBytes, type RunAttachmentMeta } from "@symbion/core";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DaemonRpcError } from "@/lib/rpc/client";
import { acquireAttachmentUrl, getCachedAttachmentUrl, putCachedAttachmentUrl, releaseAttachmentUrl } from "@/lib/run/attachmentCache";
import { useRunStore } from "@/lib/run/useRunStore";

export interface PromptAttachmentsProps {
  projectId: string;
  runId: string;
  items: readonly RunAttachmentMeta[];
}

type TileState = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "gone" } | { kind: "error" };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * One thumbnail. The bytes come ONLY from the daemon's confined `readRunAttachment`
 * (the run's stored copy) — never from event data or a URL in CLI output. The blob
 * type is the daemon-verified raster media type (never SVG).
 */
function Tile({ projectId, runId, meta, onOpen }: { projectId: string; runId: string; meta: RunAttachmentMeta; onOpen: (url: string) => void }) {
  const readRunAttachment = useRunStore((s) => s.readRunAttachment);
  const key = `${runId}:${meta.index}`;
  const [state, setState] = useState<TileState>(() => {
    const hit = getCachedAttachmentUrl(key);
    return hit ? { kind: "ready", url: hit } : { kind: "loading" };
  });

  useEffect(() => {
    if (state.kind !== "loading") return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await readRunAttachment({ projectId, runId, index: meta.index });
        const url = URL.createObjectURL(new Blob([base64ToBytes(r.data) as BlobPart], { type: r.mediaType }));
        putCachedAttachmentUrl(key, url);
        if (!cancelled) setState({ kind: "ready", url });
      } catch (err) {
        if (!cancelled) setState({ kind: err instanceof DaemonRpcError && err.code === "not-found" ? "gone" : "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.kind, readRunAttachment, projectId, runId, meta.index, key]);

  // Hold the cached URL while this tile (and its lightbox) is mounted.
  const ready = state.kind === "ready";
  useEffect(() => {
    if (!ready) return;
    acquireAttachmentUrl(key);
    return () => releaseAttachmentUrl(key);
  }, [ready, key]);

  const label = `${meta.name} · ${formatAttachmentBytes(meta.size)}`;
  if (state.kind === "ready") {
    return (
      <button
        type="button"
        title={label}
        onClick={() => onOpen(state.url)}
        className="h-16 w-16 overflow-hidden rounded-md border border-line bg-sidebar hover:border-line-strong"
        data-testid="prompt-attachment"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL of the daemon-verified stored copy */}
        <img src={state.url} alt={meta.name} className="h-full w-full object-cover" />
      </button>
    );
  }
  return (
    <span
      title={label}
      className="flex h-16 w-16 items-center justify-center rounded-md border border-line bg-sidebar p-1 text-center text-overline normal-case tracking-normal text-ink-muted"
      data-testid="prompt-attachment-placeholder"
    >
      {state.kind === "loading" ? "…" : state.kind === "gone" ? "Image no longer available" : "Couldn't load image"}
    </span>
  );
}

/** PromptAttachments — thumbnail row under the root agent's opening prompt, click to enlarge. */
export function PromptAttachments({ projectId, runId, items }: PromptAttachmentsProps) {
  const [open, setOpen] = useState<{ url: string; meta: RunAttachmentMeta } | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((m) => (
          <Tile key={m.index} projectId={projectId} runId={runId} meta={m} onOpen={(url) => setOpen({ url, meta: m })} />
        ))}
      </div>
      {open && (
        <Dialog open onClose={() => setOpen(null)} className="w-auto max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>
              {open.meta.name} · {formatAttachmentBytes(open.meta.size)}
            </DialogTitle>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL of the daemon-verified stored copy */}
          <img src={open.url} alt={open.meta.name} className="max-h-[80vh] max-w-full object-contain" />
        </Dialog>
      )}
    </>
  );
}
