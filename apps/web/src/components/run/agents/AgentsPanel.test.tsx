import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { deriveAgentTree, initRunState, type AgentView, type RunStatus, type RunSummary } from "@symbion/core";
import { AgentsPanel, type AgentsPanelProps } from "./AgentsPanel";
import { agentsPanelSessionKey } from "@/lib/run/agentsPanelSession";
import { A, B, T0, ctx, foldAll, syntheticView, textEvents } from "./agentsTestUtil";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const summary: RunSummary = {
  status: "completed",
  exitCode: 0,
  durationMs: 30_000,
  startedAt: new Date(T0).toISOString(),
  totals: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, fresh: 2, costUsd: 0.12 },
  perNode: [
    { nodeId: null, label: "/analyze", ownFresh: 1, totalFresh: 2 },
    { nodeId: null, label: "ba", ownFresh: 1, totalFresh: 1 },
  ],
  filesChanged: [],
  degraded: false,
};

function props(view: AgentView, extra?: Partial<AgentsPanelProps>): AgentsPanelProps {
  return {
    view,
    runId: "run-1",
    runStatus: "running",
    live: true,
    readOnly: false,
    loading: false,
    events: [],
    runStartedAtMs: T0,
    runInfo: { exitCode: null, stopReason: null, startedAt: new Date(T0).toISOString(), endedAt: null, filesChanged: null, lastSeq: 29, totals: null },
    degradedReason: null,
    batchSize: 1,
    onSelectAgent: vi.fn(),
    onHoverAgent: vi.fn(),
    onRerun: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  };
}

const panel = () => screen.getByTestId("agents-panel");
const detailId = () => screen.queryByTestId("agent-detail")?.getAttribute("data-agent-id") ?? null;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("AgentsPanel degraded / unavailable (W-11 / W-12)", () => {
  it("W-11: degraded chip + inline note", () => {
    render(<AgentsPanel {...props(syntheticView().view, { degradedReason: "parse-error" })} />);
    expect(screen.getByText(/telemetry degraded/i)).toBeTruthy();
    expect(screen.getByTestId("degraded-note").textContent).toContain("Subagent attribution unavailable");
  });

  it("W-12: past run with no events but lastSeq > 0 -> unavailable; [View summary] only with totals", () => {
    const empty = deriveAgentTree([], initRunState(), ctx("completed"));
    const base = props(empty, {
      readOnly: true,
      live: false,
      runStatus: "completed",
      summary,
      runInfo: { exitCode: 0, stopReason: null, startedAt: new Date(T0).toISOString(), endedAt: new Date(T0 + 1).toISOString(), filesChanged: [], lastSeq: 12, totals: null },
    });
    const { rerender } = render(<AgentsPanel {...base} />);
    expect(screen.getByText("Transcript unavailable for this run.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View summary" })).toBeNull();
    rerender(<AgentsPanel {...base} runInfo={{ ...base.runInfo!, totals: { fresh: 2, perNode: [] } }} />);
    expect(screen.getByRole("button", { name: "View summary" })).toBeTruthy();
  });
});

describe("AgentsPanel stack + keys (W-15)", () => {
  it("Enter opens; Esc collapses first then pops; Backspace pops; ↑↓ move; Esc never cancels; keys outside ignored", () => {
    const p = props(syntheticView().view);
    render(<AgentsPanel {...p} />);
    // keys outside the panel do nothing
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(detailId()).toBeNull();

    fireEvent.keyDown(panel(), { key: "ArrowDown" }); // root
    fireEvent.keyDown(panel(), { key: "ArrowDown" }); // A
    fireEvent.keyDown(panel(), { key: "Enter" });
    expect(detailId()).toBe(A);
    expect(p.onSelectAgent).toHaveBeenLastCalledWith(A);

    // expand a tool row, Esc collapses it but stays in the detail
    const transcript = screen.getByTestId("transcript-scroll");
    fireEvent.click(within(transcript).getAllByRole("button", { expanded: false })[0]!);
    expect(within(transcript).getAllByRole("button", { expanded: true }).length).toBeGreaterThan(0);
    fireEvent.keyDown(panel(), { key: "Escape" });
    expect(within(transcript).queryAllByRole("button", { expanded: true })).toHaveLength(0);
    expect(detailId()).toBe(A);
    fireEvent.keyDown(panel(), { key: "Escape" });
    expect(detailId()).toBeNull();
    expect(p.onSelectAgent).toHaveBeenLastCalledWith(null);
    // focus restored on the tree row we came from
    expect((document.querySelector(`[data-agent-id="${A}"]`) as HTMLElement).className).toContain("outline");

    // Backspace pops too
    fireEvent.click(document.querySelector(`[data-agent-id="${B}"]`)!);
    expect(detailId()).toBe(B);
    fireEvent.keyDown(panel(), { key: "Backspace" });
    expect(detailId()).toBeNull();
    // Esc at the root of the stack is a no-op (and never a cancel)
    fireEvent.keyDown(panel(), { key: "Escape" });
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /stop|cancel/i })).toBeNull();
  });

  it("spawn rows drill into children; breadcrumb navigates back up", () => {
    render(<AgentsPanel {...props(syntheticView().view)} />);
    fireEvent.click(document.querySelector(`[data-agent-id="root"]`)!);
    expect(detailId()).toBe("root");
    expect(screen.getByTestId("prompt-bubble")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open Agent ba "Solutions angle"/ }));
    expect(detailId()).toBe(B);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("button", { name: "/analyze" }));
    expect(detailId()).toBe("root");
  });

  it("openRequest (graph node click) opens the detail", () => {
    const { rerender } = render(<AgentsPanel {...props(syntheticView().view)} />);
    rerender(<AgentsPanel {...props(syntheticView().view, { openRequest: { agentId: B, nonce: 1 } })} />);
    expect(detailId()).toBe(B);
  });
});

describe("agent detail has no stop (W-16 / AC-8)", () => {
  it("root and subagent details contain no stop/cancel button", () => {
    render(<AgentsPanel {...props(syntheticView().view)} />);
    for (const id of ["root", A]) {
      fireEvent.click(document.querySelector(`[data-agent-id="${id}"]`)!);
      const header = screen.getByTestId("agent-detail-header");
      expect(within(header).queryByRole("button", { name: /stop|cancel/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /stop|cancel/i })).toBeNull();
      fireEvent.keyDown(panel(), { key: "Escape" });
    }
  });
});

describe("session restore (W-17 / AC-6)", () => {
  it("restores {view:'agent', agentId:B} once B exists; unknown id falls back to the tree", () => {
    window.sessionStorage.setItem(agentsPanelSessionKey("run-1"), JSON.stringify({ view: "agent", agentId: B }));
    const early = syntheticView("running", 4).view; // B not dispatched yet
    const { rerender } = render(<AgentsPanel {...props(early)} />);
    expect(detailId()).toBeNull();
    rerender(<AgentsPanel {...props(syntheticView().view)} />);
    expect(detailId()).toBe(B);
  });

  it("review fix #5: keeps waiting through full backfill chunks / non-live connection before giving up", () => {
    window.sessionStorage.setItem(agentsPanelSessionKey("run-4"), JSON.stringify({ view: "agent", agentId: B }));
    const early = syntheticView("running", 4).view; // B not dispatched yet
    const base = props(early, { runId: "run-4", batchSize: 500 });
    const { rerender } = render(<AgentsPanel {...base} />);
    expect(detailId()).toBeNull();
    // still reconnecting, short chunk: keep waiting
    rerender(<AgentsPanel {...base} batchSize={3} connectionLive={false} />);
    expect(detailId()).toBeNull();
    // terminal but not caught up (eventCount 4 < lastSeq 29): keep waiting
    rerender(<AgentsPanel {...base} runStatus="completed" live={false} />);
    expect(detailId()).toBeNull();
    // the rest of the backfill arrives -> restored
    rerender(<AgentsPanel {...base} view={syntheticView().view} />);
    expect(detailId()).toBe(B);
  });

  it("unknown agentId -> tree", () => {
    window.sessionStorage.setItem(agentsPanelSessionKey("run-2"), JSON.stringify({ view: "agent", agentId: "toolu_gone" }));
    render(<AgentsPanel {...props(syntheticView("completed").view, { runId: "run-2", runStatus: "completed", live: false })} />);
    expect(detailId()).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(agentsPanelSessionKey("run-2"))!)).toEqual({ view: "tree" });
  });

  it("writes the open detail per run", () => {
    render(<AgentsPanel {...props(syntheticView().view, { runId: "run-3" })} />);
    fireEvent.click(document.querySelector(`[data-agent-id="${A}"]`)!);
    expect(JSON.parse(window.sessionStorage.getItem(agentsPanelSessionKey("run-3"))!)).toEqual({ view: "agent", agentId: A });
  });
});

describe("terminal states (S3 / S4c)", () => {
  it("Outcome card at terminal; [View summary] pushes the summary; ← Agents pops", () => {
    const { view } = syntheticView("completed");
    render(<AgentsPanel {...props(view, { runStatus: "completed", live: false, summary })} />);
    expect(screen.getByTestId("run-outcome-card").textContent).toContain("✓ Completed");
    fireEvent.click(screen.getByRole("button", { name: "View summary" }));
    expect(screen.getByText(/Summary — ✓ completed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← Agents" }));
    expect(screen.getByTestId("run-outcome-card")).toBeTruthy();
  });

  it("run ends while inside a detail -> 'Run finished' strip, no auto-navigation", () => {
    const live = props(syntheticView("running").view);
    const { rerender } = render(<AgentsPanel {...live} />);
    fireEvent.click(document.querySelector(`[data-agent-id="${A}"]`)!);
    const status: RunStatus = "completed";
    rerender(<AgentsPanel {...live} view={syntheticView(status).view} runStatus={status} live={false} summary={summary} />);
    expect(detailId()).toBe(A);
    expect(screen.getByTestId("run-finished-strip").textContent).toContain("Run finished — ✓ completed");
  });
});

describe("RawEventLog via ≡ (W-20)", () => {
  it("history mode shows the history run's 1,500 events (not the live tail), windowed", () => {
    const events = textEvents(1_500);
    const view = deriveAgentTree(events, foldAll(events), ctx("completed"));
    const { container } = render(<AgentsPanel {...props(view, { readOnly: true, live: false, runStatus: "completed", events })} />);
    fireEvent.click(document.querySelector(`[data-agent-id="root"]`)!);
    fireEvent.click(screen.getByRole("button", { name: "View raw events" }));
    expect(screen.getByText("RAW · 1500 events")).toBeTruthy();
    const rendered = container.querySelectorAll("[data-raw-seq]");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThanOrEqual(60);
    fireEvent.click(screen.getByRole("button", { name: "← back" }));
    expect(detailId()).toBe("root");
  });
});

describe("chronological transcript (agent detail)", () => {
  it("hides unknown events like rate_limit_event (raw view keeps them); renders text as markdown; Run again at terminal", () => {
    const base = textEvents(1);
    const events = [
      ...base,
      { seq: 2, ts: T0 + 5, ev: { kind: "unknown" as const, type: "rate_limit_event", rawTruncated: '{"type":"rate_limit_event"}' } },
      {
        seq: 3,
        ts: T0 + 6,
        ev: {
          kind: "message" as const,
          messageId: "m-final",
          parentToolUseId: null,
          model: "m",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          parts: [{ kind: "text" as const, textPreview: "**Xong** rồi" }],
        },
      },
    ];
    const view = deriveAgentTree(events, foldAll(events), ctx("completed"));
    const onRerun = vi.fn();
    render(<AgentsPanel {...props(view, { readOnly: true, live: false, runStatus: "completed", events, onRerun })} />);
    fireEvent.click(document.querySelector(`[data-agent-id="root"]`)!);
    const transcript = screen.getByTestId("transcript-scroll");
    expect(transcript.textContent).not.toMatch(/rate_limit|unrecognized/);
    expect(within(transcript).getByText("Xong").tagName).toBe("STRONG");
    expect(transcript.textContent).not.toContain("**");
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRerun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View raw events" }));
    expect(screen.getByTestId("agents-panel").textContent).toContain("rate_limit_event");
  });
});

describe("long transcripts (replaces W-9 / AC-10)", () => {
  it("2,500 steps render at most 300 blocks; 'Show earlier' reveals 200 more", () => {
    const events = textEvents(2_500);
    const view = deriveAgentTree(events, foldAll(events), ctx("completed"));
    render(<AgentsPanel {...props(view, { readOnly: true, live: false, runStatus: "completed", events })} />);
    fireEvent.click(document.querySelector(`[data-agent-id="root"]`)!);
    const count = () => screen.getByTestId("transcript-scroll").querySelectorAll("[data-block-kind]").length;
    expect(count()).toBe(300);
    fireEvent.click(screen.getByRole("button", { name: /Show 200 earlier steps/ }));
    expect(count()).toBe(500);
  });
});
