"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Code, Copy, RotateCcw } from "lucide-react";
import type { AgentNode, TranscriptRow } from "@symbion/core";
import { IconButton } from "@/components/ui/icon-button";
import { JumpToLatestPill } from "./JumpToLatestPill";
import { LiveDuration } from "./LiveDuration";
import { BlockErrorBoundary, BlockView, CollapseEpochContext } from "./TranscriptBlocks";
import type { PromptAttachmentsProps } from "./PromptAttachments";
import {
  blockIndexOfRow,
  buildTranscriptBlocks,
  indexBlocks,
  lastTextMarkdown,
  runErrorLabel,
  stabilizeBlocks,
  type TranscriptBlock,
} from "./transcriptBlocks";
import { fmtCost, fmtDurationWords, fmtTok } from "./format";

/** Newest blocks rendered up front; older ones sit behind "Show earlier steps". */
const BLOCK_WINDOW = 300;
/** Blocks revealed per "Show earlier steps" click. */
const BLOCK_PAGE = 200;
/** Within this many px of the bottom counts as "following". */
const FOLLOW_SLACK_PX = 48;

export interface BreadcrumbSegment {
  id: string;
  label: string;
}

/** Keyboard surface the AgentsPanel drives (j/k, End, Esc). */
export interface TranscriptListHandle {
  /** collapse expanded steps; true if anything was open (Esc step 1). */
  collapseAll: () => boolean;
  jumpToLatest: () => void;
  moveFocus: (delta: number) => void;
  toggleFocused: () => void;
  activateFocused: () => void;
}

export interface AgentDetailViewProps {
  agent: AgentNode;
  rows: readonly TranscriptRow[];
  breadcrumb: BreadcrumbSegment[];
  spawnedByLabel: string | null;
  /** streaming: drives follow / pill. */
  live: boolean;
  /** pulses + tickers (false while reconnecting); defaults to `live`. */
  pulsesLive?: boolean;
  readOnly: boolean;
  cancelling?: boolean;
  nowMs: number;
  scrollToRowId?: string | null;
  onBack: () => void;
  onNavigate: (agentId: string) => void;
  /** root only: open the raw event log. */
  onRaw?: () => void;
  /** root only, once the run has ended: start the same command again. */
  onRerun?: () => void;
  /** root only: files changed by the run (null = unknown). */
  filesChanged?: number | null;
  /** root only: run cost in USD. */
  costUsd?: number;
  /** S4c strip, rendered at the bottom when present. */
  finishedStrip?: ReactNode;
  /** root only: the run's stored images, shown as thumbnails under the opening prompt. */
  promptAttachments?: PromptAttachmentsProps;
}

const STATUS: Record<AgentNode["status"], { word: string; dot: string; text: string }> = {
  starting: { word: "Starting", dot: "bg-running motion-safe:animate-livePulse", text: "text-ink-muted" },
  running: { word: "Running", dot: "bg-running motion-safe:animate-livePulse", text: "text-ink-muted" },
  done: { word: "Done", dot: "bg-success", text: "text-success" },
  error: { word: "Failed", dot: "bg-danger", text: "text-danger-text" },
  interrupted: { word: "Interrupted", dot: "bg-ink-faint", text: "text-ink-muted" },
};

const FOOTER_WORD: Record<AgentNode["status"], string> = {
  starting: "Starting…",
  running: "Running…",
  done: "Success",
  error: "Error",
  interrupted: "Interrupted",
};

const shortModel = (m?: string) => m?.replace(/^claude-/, "") ?? "";

/**
 * S4 — one agent's detail as a single chronological transcript (prompt,
 * thinking, text, tool calls, subagents), with a compact header and a footer
 * summary. Deliberately has NO stop / cancel affordance (AC-8): the only stop
 * is "■ Stop run" in the status strip / RunBar.
 */
export const AgentDetailView = forwardRef<TranscriptListHandle, AgentDetailViewProps>(function AgentDetailView(
  {
    agent,
    rows,
    breadcrumb,
    spawnedByLabel,
    live,
    pulsesLive,
    readOnly,
    cancelling,
    nowMs,
    scrollToRowId,
    onBack,
    onNavigate,
    onRaw,
    onRerun,
    filesChanged,
    costUsd,
    finishedStrip,
    promptAttachments,
  },
  ref
) {
  const running = agent.status === "running" || agent.status === "starting";
  const streaming = live && running;
  const follow = streaming && !readOnly;
  const isRoot = agent.kind === "root";
  // Unchanged blocks keep their object identity across event batches so the
  // memoised block components (and their markdown) don't re-render.
  const blockIndex = useRef<ReadonlyMap<string, TranscriptBlock>>(new Map());
  const blocks = useMemo(() => {
    const next = stabilizeBlocks(blockIndex.current, buildTranscriptBlocks(agent, rows, live));
    blockIndex.current = indexBlocks(next);
    return next;
  }, [agent, rows, live]);
  const [windowSize, setWindowSize] = useState(BLOCK_WINDOW);
  const lastMd = lastTextMarkdown(blocks);
  const [copied, setCopied] = useState(false);
  const [collapseEpoch, setCollapseEpoch] = useState(0);

  // --- follow the bottom while streaming; scrolling up pauses, the pill resumes ---
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const prevLen = useRef(blocks.length);
  // While paused, the window's first block stays put so content doesn't shift under the reader.
  const pausedStart = useRef<number | null>(null);
  const naturalStart = Math.max(0, blocks.length - windowSize);
  const start = follow && paused && pausedStart.current !== null ? Math.min(pausedStart.current, naturalStart) : naturalStart;
  const shownBlocks = start > 0 ? blocks.slice(start) : blocks;

  const pause = () => {
    if (!follow) return;
    if (followingRef.current) pausedStart.current = naturalStart;
    followingRef.current = false;
    setPaused(true);
  };

  const toBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useLayoutEffect(() => {
    const added = blocks.length - prevLen.current;
    prevLen.current = blocks.length;
    if (!follow) return;
    if (followingRef.current) toBottom();
    else if (added > 0) setNewCount((n) => n + added);
  }, [blocks, follow]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !follow) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
    if (!atBottom) {
      pause();
      return;
    }
    followingRef.current = true;
    pausedStart.current = null;
    setPaused(false);
    setNewCount(0);
  };

  // Opening a step pauses follow, so the step doesn't scroll away on the next batch.
  const onClickCapture = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button[aria-expanded="false"]')) pause();
  };

  const jumpToLatest = () => {
    followingRef.current = true;
    pausedStart.current = null;
    setPaused(false);
    setNewCount(0);
    toBottom();
  };

  // Background-task jump: scroll the launching step into view once.
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollToRowId || scrolledToRef.current === scrollToRowId) return;
    const idx = blockIndexOfRow(blocks, scrollToRowId);
    if (idx < 0) return;
    if (idx < start) {
      // the launching step is older than the window — widen it, then retry
      setWindowSize(blocks.length - idx + BLOCK_PAGE);
      return;
    }
    const sel = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(scrollToRowId) : scrollToRowId.replace(/["\\]/g, "");
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row-id="${sel}"]`);
    if (!el) return;
    scrolledToRef.current = scrollToRowId;
    followingRef.current = false;
    el.scrollIntoView?.({ block: "center" });
    el.querySelector<HTMLElement>("button")?.focus();
  }, [scrollToRowId, blocks, start]);

  useImperativeHandle(
    ref,
    () => ({
      collapseAll: () => {
        if (!scrollRef.current?.querySelector('[aria-expanded="true"]')) return false;
        setCollapseEpoch((e) => e + 1);
        return true;
      },
      jumpToLatest,
      moveFocus: (delta: number) => {
        const root = scrollRef.current;
        if (!root) return;
        const buttons = [...root.querySelectorAll<HTMLButtonElement>("button[data-step]")];
        if (buttons.length === 0) return;
        const cur = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = Math.max(0, Math.min(buttons.length - 1, cur < 0 ? (delta > 0 ? 0 : buttons.length - 1) : cur + delta));
        buttons[next]!.focus();
        buttons[next]!.scrollIntoView?.({ block: "nearest" });
      },
      // Space / Enter on a focused step are handled natively by its button.
      toggleFocused: () => undefined,
      activateFocused: () => undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const status = STATUS[agent.status];
  const statusWord = cancelling && running ? "Stopping…" : status.word;
  const durationMs = agent.startedAtMs !== null && agent.endedAtMs !== undefined ? agent.endedAtMs - agent.startedAtMs : null;
  const ticking = (pulsesLive ?? live) && running && !cancelling;
  const lastBlockId = shownBlocks[shownBlocks.length - 1]?.id;
  const cost = isRoot ? fmtCost(costUsd) : null;
  // Root: core reports the last assistant text as the "result", which is not a
  // failure reason — use the run's error result line instead.
  const errorText = isRoot
    ? `Run failed${runErrorLabel(rows) ? ` — ${runErrorLabel(rows)}` : ""}`
    : agent.result?.isError && agent.result.text.trim()
      ? agent.result.text.split("\n")[0]
      : "Agent failed";

  return (
    <div className="flex h-full min-h-0 flex-col motion-safe:animate-slideIn" data-testid="agent-detail" data-agent-id={agent.id}>
      {/* header: back · breadcrumb · status / meta line · actions */}
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5" data-testid="agent-detail-header">
        <IconButton aria-label="Back to agents" icon={ArrowLeft} size="sm" tooltip={false} onClick={onBack} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 truncate font-mono text-body font-medium text-ink">
              {breadcrumb.map((seg, i) => (
                <span key={seg.id} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <span className="text-ink-muted">›</span>}
                  {i === breadcrumb.length - 1 ? (
                    <span className="truncate">{seg.label}</span>
                  ) : (
                    <button type="button" className="truncate text-ink-muted hover:text-ink" onClick={() => onNavigate(seg.id)}>
                      {seg.label}
                    </button>
                  )}
                </span>
              ))}
            </nav>
            <span className={`inline-flex shrink-0 items-center gap-1.5 text-caption ${status.text}`}>
              <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${status.dot}`} />
              {statusWord}
            </span>
          </div>
          <p className="truncate font-mono text-code-sm text-ink-muted">
            {[shortModel(agent.model), agent.kind === "subagent" ? agent.mode : ""].filter(Boolean).map((m) => `${m} · `)}
            <LiveDuration startedAtMs={agent.startedAtMs} endedAtMs={agent.endedAtMs} nowMs={nowMs} ticking={ticking} /> ·{" "}
            <span
              title={`own: in ${agent.usage.input} · out ${agent.usage.output} · cache read ${agent.usage.cacheRead} · cache write ${agent.usage.cacheWrite}`}
            >
              {fmtTok(agent.freshTokens)} tok
            </span>{" "}
            · {agent.toolCount} tool{agent.toolCount === 1 ? "" : "s"}
            {agent.errorCount > 0 && (
              <span className="text-danger-text">
                {" "}
                · {agent.errorCount} error{agent.errorCount === 1 ? "" : "s"}
              </span>
            )}
          </p>
          {agent.spawnedBy && spawnedByLabel && (
            <p className="text-caption text-ink-muted">
              spawned by{" "}
              <button type="button" className="text-ink underline decoration-dotted" onClick={() => onNavigate(agent.spawnedBy!)}>
                {spawnedByLabel} ›
              </button>
            </p>
          )}
        </div>
        {onRerun && !running && <IconButton aria-label="Run again" icon={RotateCcw} size="sm" onClick={onRerun} />}
        {isRoot && onRaw && <IconButton aria-label="View raw events" icon={Code} size="sm" onClick={onRaw} />}
      </div>

      {/* chronological transcript */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onClickCapture={onClickCapture}
          className="h-full overflow-y-auto overflow-x-hidden px-5 pb-6 pt-4"
          data-testid="transcript-scroll"
          role="log"
          aria-label="Transcript"
        >
          <CollapseEpochContext.Provider value={collapseEpoch}>
            <div className="flex flex-col gap-3">
              {start > 0 && (
                <button
                  type="button"
                  className="self-start text-caption text-ink-muted hover:text-ink"
                  onClick={() => setWindowSize((n) => n + BLOCK_PAGE)}
                >
                  Show {Math.min(start, BLOCK_PAGE)} earlier step{Math.min(start, BLOCK_PAGE) === 1 ? "" : "s"} ({start} hidden)
                </button>
              )}
              {shownBlocks.map((b) => (
                <div key={b.id} data-row-id={b.kind === "toolGroup" ? undefined : b.id} data-block-kind={b.kind}>
                  {/* re-keyed as streamed text grows so a failed render can recover */}
                  <BlockErrorBoundary key={b.kind === "text" ? b.markdown.length : 0}>
                    <BlockView
                      block={b}
                      streaming={streaming && b.id === lastBlockId}
                      onOpenAgent={onNavigate}
                      promptAttachments={isRoot && b.kind === "prompt" ? promptAttachments : undefined}
                    />
                  </BlockErrorBoundary>
                </div>
              ))}
              {blocks.length === 0 && (
                <p className="text-caption text-ink-muted">{streaming ? "Waiting for the first step…" : "No steps recorded."}</p>
              )}
              {!running && lastMd && (
                <div className="-ml-1.5 flex gap-0.5">
                  <IconButton
                    aria-label={copied ? "Copied" : "Copy as markdown"}
                    icon={copied ? Check : Copy}
                    size="sm"
                    onClick={() => {
                      try {
                        void navigator.clipboard?.writeText(lastMd)?.catch(() => undefined);
                      } catch {
                        /* clipboard unavailable */
                      }
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1_200);
                    }}
                  />
                </div>
              )}
              {agent.status === "error" && (
                <div className="rounded-sm border border-danger bg-danger-soft px-3 py-2.5 text-label font-normal text-danger-text" role="alert">
                  {errorText}
                </div>
              )}
            </div>
          </CollapseEpochContext.Provider>
        </div>
        {follow && paused && <JumpToLatestPill count={newCount} onJump={jumpToLatest} />}
        {/* one short line for screen readers instead of reading every appended block */}
        <p className="sr-only" aria-live="polite">
          {streaming ? (agent.nowDoing ?? "") : statusWord}
        </p>
      </div>

      {/* footer summary */}
      {!running && (
        <div className="flex items-center justify-between gap-3 border-t border-line bg-sidebar px-4 py-2.5 text-caption text-ink-muted" data-testid="agent-detail-footer">
          <span
            className={`inline-flex min-w-0 items-center gap-1.5 truncate ${
              agent.status === "done" ? "text-success" : agent.status === "error" ? "text-danger-text" : ""
            }`}
          >
            {agent.status === "done" && <Check size={13} strokeWidth={2.5} aria-hidden />}
            {FOOTER_WORD[agent.status]}
            {isRoot && filesChanged ? ` · ${filesChanged} file${filesChanged === 1 ? "" : "s"} changed` : ""}
            {readOnly ? " · read-only" : ""}
          </span>
          <span className="shrink-0 font-mono tabular-nums">
            {[fmtDurationWords(durationMs), `${fmtTok(agent.freshTokens)} tok`, cost].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
      {finishedStrip}
    </div>
  );
});
