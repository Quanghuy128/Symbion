"use client";

import { Component, createContext, memo, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronRight,
  FileText,
  Folder,
  Globe,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Markdown } from "./Markdown";
import { TRUNCATION_NOTE } from "./format";
import { displayToolName, type DiffLine, type TodoItem, type ToolBlock, type ToolBlockStatus, type TranscriptBlock } from "./transcriptBlocks";

/** Lines of tool output shown before "… N more lines". */
const OUTPUT_LINE_CAP = 40;
/** Diff lines shown before "Show all". */
const DIFF_PREVIEW_LINES = 12;

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  NotebookRead: FileText,
  Grep: Search,
  Glob: Search,
  LS: Folder,
  Bash: SquareTerminal,
  BashOutput: SquareTerminal,
  Edit: Pencil,
  MultiEdit: Pencil,
  Write: Pencil,
  NotebookEdit: Pencil,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Bot,
  Agent: Bot,
};

const iconFor = (name: string): LucideIcon => TOOL_ICONS[name] ?? Wrench;

/** "Read x.ts (40–189)" -> "x.ts (40–189)" when the label starts with the tool name. */
function argOf(tool: ToolBlock): string {
  const l = tool.label;
  return l.startsWith(`${tool.name} `) ? l.slice(tool.name.length + 1) : l === tool.name ? "" : l;
}

function capLines(s: string, max: number): string {
  const lines = s.split("\n");
  return lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more lines`].join("\n") : s;
}

/** Bumped by the detail view on Esc: every expanded step collapses. */
export const CollapseEpochContext = createContext(0);

/** Disclosure state that closes whenever the collapse epoch changes. */
function useDisclosure(initial: boolean): [boolean, (fn: (o: boolean) => boolean) => void] {
  const [open, setOpen] = useState(initial);
  const epoch = useContext(CollapseEpochContext);
  const seen = useRef(epoch);
  useEffect(() => {
    if (seen.current === epoch) return;
    seen.current = epoch;
    setOpen(false);
  }, [epoch]);
  return [open, setOpen];
}

/** Per-block render error boundary — the panel must never throw. */
export class BlockErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    /* swallowed */
  }
  render(): ReactNode {
    if (this.state.failed) {
      return (
        <p className="text-caption text-ink-muted" role="note">
          couldn&apos;t render this step
        </p>
      );
    }
    return this.props.children;
  }
}

function Spinner() {
  return (
    <>
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-mint-text motion-reduce:animate-none"
      />
      <span className="sr-only">running</span>
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={12}
      strokeWidth={2.5}
      aria-hidden
      className={`shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
    />
  );
}

function OutputPre({ text, truncated, label }: { text: string; truncated?: boolean; label?: string }) {
  return (
    <div className="border-t border-line-soft bg-deep">
      {label && <p className="px-3 pt-1.5 text-overline uppercase text-ink-muted">{label}</p>}
      {/* Plain text — tool output is untrusted and never parsed. */}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-code-sm text-ink-2">
        {capLines(text, OUTPUT_LINE_CAP)}
      </pre>
      {truncated && <p className="px-3 pb-1.5 text-overline normal-case tracking-normal text-warning">{TRUNCATION_NOTE}</p>}
    </div>
  );
}

export function PromptBubble({ text, truncated }: { text: string; truncated: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 400 || text.split("\n").length > 6;
  return (
    <div className="rounded-md border border-line-strong bg-surface px-3.5 py-2.5 text-ui text-ink" data-testid="prompt-bubble">
      <p className={`whitespace-pre-wrap break-words ${long && !open ? "line-clamp-6" : ""}`}>{text}</p>
      {(long || truncated) && (
        <div className="mt-1 flex items-center justify-between gap-2">
          {truncated ? <span className="text-overline normal-case tracking-normal text-warning">{TRUNCATION_NOTE}</span> : <span />}
          {long && (
            <button type="button" className="text-caption text-ink-muted hover:text-ink" onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ThinkingRow({ text, durationMs }: { text: string; durationMs?: number }) {
  const [open, setOpen] = useDisclosure(false);
  const label = durationMs ? `Thought for ${Math.max(1, Math.round(durationMs / 1000))}s` : "Thinking";
  const hasBody = text.trim().length > 0;
  return (
    <div>
      <button
        type="button"
        aria-expanded={hasBody ? open : undefined}
        aria-disabled={hasBody ? undefined : true}
        onClick={() => hasBody && setOpen((o) => !o)}
        data-step
        className="-ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-xs px-1.5 text-label font-normal text-ink-muted hover:text-ink aria-disabled:cursor-default aria-disabled:hover:text-ink-muted"
      >
        {hasBody && <Chevron open={open} />}
        {label}
      </button>
      {open && hasBody && (
        <p className="mt-1 whitespace-pre-wrap border-l-2 border-line-strong pl-3 text-label font-normal italic leading-relaxed text-ink-muted">
          {text}
        </p>
      )}
    </div>
  );
}

function statusSummary(tool: ToolBlock): ReactNode {
  if (tool.status === "running") return <Spinner />;
  if (tool.status === "interrupted") return <span className="shrink-0 text-caption text-ink-muted">interrupted</span>;
  if (tool.status === "error") return <span className="shrink-0 text-caption text-danger-text">{tool.resultLabel ?? "failed"}</span>;
  return tool.resultLabel ? <span className="shrink-0 text-caption text-ink-muted">{tool.resultLabel}</span> : null;
}

/** One tool call: icon · name · main argument · summary; expands to its input/output. */
export const ToolRow = memo(function ToolRow({ tool }: { tool: ToolBlock }) {
  const [open, setOpen] = useDisclosure(tool.status === "error");
  // a step that fails while live opens itself, like one replayed as failed
  useEffect(() => {
    if (tool.status === "error") setOpen(() => true);
  }, [tool.status, setOpen]);
  const Icon = iconFor(tool.name);
  const hasOutput = (tool.output?.length ?? 0) > 0;
  const hasInput = (tool.input?.length ?? 0) > 0;
  const hasBody = hasOutput || hasInput;
  const isError = tool.status === "error";
  const arg = argOf(tool);
  return (
    <div data-testid="tool-row" data-row-id={tool.id} data-tool={tool.name} data-status={tool.status}>
      <button
        type="button"
        aria-expanded={hasBody ? open : undefined}
        aria-disabled={hasBody ? undefined : true}
        onClick={() => hasBody && setOpen((o) => !o)}
        data-step
        className={`flex min-h-9 w-full items-center gap-2.5 px-3 py-2 text-left text-label font-normal aria-disabled:cursor-default ${
          isError ? "bg-danger-soft" : "hover:bg-surface-hover aria-disabled:hover:bg-transparent"
        }`}
      >
        <Icon size={14} strokeWidth={2} aria-hidden className={`shrink-0 ${isError ? "text-danger-text" : "text-ink-muted"}`} />
        <span className="shrink-0 font-medium text-ink">{displayToolName(tool.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-code-sm text-ink-3" title={tool.label}>
          {arg}
        </span>
        {tool.background && <span className="shrink-0 text-caption text-ink-muted">background</span>}
        {statusSummary(tool)}
        {hasBody && <Chevron open={open} />}
      </button>
      {open && hasBody && (
        <>
          {hasInput && <OutputPre label="Input" text={tool.input!} />}
          {hasOutput && <OutputPre label={hasInput ? "Output" : undefined} text={tool.output!} truncated={tool.outputTruncated} />}
        </>
      )}
    </div>
  );
});

function Card({ error, children, testId }: { error?: boolean; children: ReactNode; testId?: string }) {
  return (
    <div className={`overflow-hidden rounded-sm border ${error ? "border-danger" : "border-line"}`} data-testid={testId}>
      {children}
    </div>
  );
}

export function ToolGroup({ tools }: { tools: ToolBlock[] }) {
  return (
    <div className="divide-y divide-line-soft overflow-hidden rounded-sm border border-line" data-testid="tool-group">
      {tools.map((t) => (
        <ToolRow key={t.id} tool={t} />
      ))}
    </div>
  );
}

export function DiffCard({ tool, filePath, lines }: { tool: ToolBlock; filePath: string; lines: DiffLine[] }) {
  const [all, setAll] = useState(false);
  const add = lines.filter((l) => l.sign === "+").length;
  const del = lines.length - add;
  const shown = all ? lines : lines.slice(0, DIFF_PREVIEW_LINES);
  const isError = tool.status === "error";
  return (
    <Card error={isError} testId="diff-card">
      <div className="flex items-center gap-2.5 bg-surface px-3 py-2 text-label font-normal">
        <Pencil size={14} strokeWidth={2} aria-hidden className={isError ? "text-danger-text" : "text-ink-muted"} />
        <span className="shrink-0 font-medium text-ink">{tool.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-code-sm text-ink-3" title={filePath}>
          {filePath}
        </span>
        {tool.status === "running" ? (
          <Spinner />
        ) : tool.status === "interrupted" ? (
          <span className="shrink-0 text-caption text-ink-muted">interrupted</span>
        ) : (
          <span className="shrink-0 font-mono text-code-sm">
            <span className="text-success">+{add}</span> <span className="text-danger-text">−{del}</span>
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <div className="overflow-x-auto bg-deep py-1 font-mono text-code-sm">
          {shown.map((l, i) => (
            <div
              key={i}
              className={`whitespace-pre px-3 ${l.sign === "+" ? "bg-diff-add text-success" : "bg-diff-del text-danger-text"}`}
            >
              {l.sign} {l.text}
            </div>
          ))}
        </div>
      )}
      {lines.length > DIFF_PREVIEW_LINES && (
        <button type="button" className="px-3 py-1.5 text-caption text-mint-text hover:underline" onClick={() => setAll((a) => !a)}>
          {all ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
      {isError && tool.output && <OutputPre text={tool.output} truncated={tool.outputTruncated} />}
    </Card>
  );
}

export function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="flex flex-col gap-1.5 rounded-sm border border-line px-3 py-2.5 text-label font-normal" data-testid="todo-list">
      {todos.map((t, i) => (
        <li
          key={i}
          className={`flex items-baseline gap-2 ${
            t.status === "completed" ? "text-ink-muted line-through" : t.status === "in_progress" ? "font-medium text-ink" : "text-ink-2"
          }`}
        >
          <span
            aria-hidden
            className="inline-flex h-3.5 w-3.5 shrink-0 translate-y-0.5 items-center justify-center rounded-[4px] border border-line-strong text-overline text-mint-text no-underline"
          >
            {t.status === "completed" ? "✓" : t.status === "in_progress" ? "•" : ""}
          </span>
          <span>
            <span className="sr-only">{t.status.replace("_", " ")}: </span>
            {t.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SpawnRow({ label, status, onOpen }: { label: string; status: ToolBlockStatus; onOpen: () => void }) {
  return (
    <Card error={status === "error"} testId="spawn-row">
      <button
        type="button"
        aria-label={`Open ${label}`}
        onClick={onOpen}
        data-step
        className="flex min-h-9 w-full items-center gap-2.5 px-3 py-2 text-left text-label font-normal hover:bg-surface-hover"
      >
        <Bot size={14} strokeWidth={2} aria-hidden className="shrink-0 text-agent" />
        <span className="min-w-0 flex-1 truncate text-ink" title={label}>
          {label}
        </span>
        {status === "running" ? (
          <Spinner />
        ) : status === "error" ? (
          <span className="shrink-0 text-caption text-danger-text">failed</span>
        ) : status === "interrupted" ? (
          <span className="shrink-0 text-caption text-ink-muted">interrupted</span>
        ) : null}
        <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-muted" />
      </button>
    </Card>
  );
}

/** The single switch: block.kind -> component. */
export const BlockView = memo(function BlockView({
  block,
  streaming,
  onOpenAgent,
}: {
  block: TranscriptBlock;
  /** this is the block still being written (unclosed code fences are closed for display). */
  streaming: boolean;
  onOpenAgent: (agentId: string) => void;
}) {
  switch (block.kind) {
    case "prompt":
      return <PromptBubble text={block.text} truncated={block.truncated} />;
    case "thinking":
      return <ThinkingRow text={block.text} durationMs={block.durationMs} />;
    case "text":
      return (
        <div>
          <Markdown source={block.markdown} streaming={streaming} />
          {block.truncated && <p className="mt-1 text-overline normal-case tracking-normal text-warning">{TRUNCATION_NOTE}</p>}
        </div>
      );
    case "toolGroup":
      return <ToolGroup tools={block.tools} />;
    case "todo":
      return <TodoList todos={block.todos} />;
    case "edit":
      return <DiffCard tool={block.tool} filePath={block.filePath} lines={block.lines} />;
    case "notice":
      return (
        <p
          className={`rounded-sm border px-3 py-2 text-label font-normal ${
            block.tone === "error" ? "border-danger bg-danger-soft text-danger-text" : "border-line text-ink-muted"
          }`}
          data-testid="transcript-notice"
        >
          {block.text}
        </p>
      );
    case "spawn":
      return <SpawnRow label={block.label} status={block.status} onOpen={() => onOpenAgent(block.childAgentId)} />;
    case "tool":
      return (
        <Card error={block.status === "error"}>
          <ToolRow tool={block} />
        </Card>
      );
  }
});
