import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { foldAgentTreeBatch, initAgentTree, type CanonicalArtifact, type RunInfo } from "@symbion/core";
import { DependencyGraph } from "./DependencyGraph";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { useRunStore } from "@/lib/run/useRunStore";
import { A, B, T0, foldAll, syntheticLines, toEvents } from "./run/agents/agentsTestUtil";

/** W-14 — graph node click in mission mode opens the Agents panel detail /
 *  the instance picker / a toast. */
vi.mock("@/lib/rpc/client", () => ({
  callRpc: vi.fn((method: string) => {
    if (method === "getNodeLayout") return Promise.resolve({ positions: {} });
    if (method === "listRuns") return Promise.resolve({ runs: [] });
    return Promise.resolve({});
  }),
  getDaemonOrigin: () => "http://127.0.0.1:1",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function art(id: string, kind: "command" | "agent", name: string, body = "body"): CanonicalArtifact {
  return {
    id,
    kind,
    name,
    description: "d",
    body,
    meta: { version: "draft", status: "draft", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  };
}

const artifacts = [
  art("cmd-1", "command", "analyze", "Use @ba and @code-reviewer."),
  art("ag-ba", "agent", "ba"),
  art("ag-cr", "agent", "code-reviewer"),
];

function runInfo(): RunInfo {
  return {
    schemaVersion: 1,
    runId: "r1",
    projectId: "p1",
    artifactId: "cmd-1",
    commandName: "analyze",
    requirement: "add run diff",
    modelOverride: null,
    argv: [],
    bin: "claude",
    cwd: "/tmp",
    permissionMode: "acceptEdits",
    allowedTools: [],
    ceilings: { wallClockMs: 1, tokenCap: 1 },
    cliVersion: "2.1.187",
    sessionId: null,
    startedAt: new Date(T0).toISOString(),
    endedAt: null,
    status: "running",
    exitCode: null,
    stopReason: null,
    errorMessage: null,
    gitBefore: { isRepo: true, clean: true, changedFiles: [] },
    filesChanged: null,
    lastSeq: 29,
    totals: null,
  };
}

const showToast = vi.fn();

beforeEach(() => {
  window.sessionStorage.clear(); // per-run panel view restore must not leak between tests
  const events = toEvents(syntheticLines());
  useArtifactStore.setState({ daemonConnected: true, showToast } as never);
  useRunStore.setState({
    projectId: "p1",
    run: runInfo(),
    activeArtifactId: "cmd-1",
    connection: "live",
    allEvents: events,
    lastSeq: events.length,
    foldState: foldAll(events),
    agentTree: foldAgentTreeBatch(initAgentTree(), events),
    attachIfActive: vi.fn(async () => {}),
  } as never);
});
afterEach(() => {
  showToast.mockReset();
  useRunStore.setState({ run: null, activeArtifactId: null, agentTree: initAgentTree(), allEvents: [] } as never);
});

const node = (id: string) => document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
const detailId = () => screen.queryByTestId("agent-detail")?.getAttribute("data-agent-id") ?? null;

describe("DependencyGraph — node click → Agents panel (W-14)", () => {
  it("command node selects the root detail", async () => {
    render(<DependencyGraph artifacts={artifacts} onEditArtifact={() => {}} projectId="p1" projectName="P" />);
    await waitFor(() => expect(screen.getByTestId("agents-panel")).toBeTruthy());
    fireEvent.click(node("cmd-1"));
    expect(detailId()).toBe("root");
    // selection halo outside the status ring on the command node
    await waitFor(() => expect(node("cmd-1").querySelector("[data-run-halo='selected']")).not.toBeNull());
  });

  it("agent `ba` with 2 instances -> picker (↑↓ + Enter picks)", async () => {
    render(<DependencyGraph artifacts={artifacts} onEditArtifact={() => {}} projectId="p1" projectName="P" />);
    await waitFor(() => expect(screen.getByTestId("agents-panel")).toBeTruthy());
    fireEvent.click(node("ag-ba"));
    const picker = screen.getByRole("listbox", { name: "ba instances" });
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
    expect(within(picker).getByText("ba ran 2 times")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(picker, { key: "ArrowDown" });
    });
    fireEvent.keyDown(picker, { key: "Enter" });
    expect(detailId()).toBe(B);
    expect(screen.queryByRole("listbox")).toBeNull();
    // clicking the first option path also works
    fireEvent.click(node("ag-ba"));
    fireEvent.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]!);
    expect(detailId()).toBe(A);
  });

  it("agent that did not run -> toast", async () => {
    render(<DependencyGraph artifacts={artifacts} onEditArtifact={() => {}} projectId="p1" projectName="P" />);
    await waitFor(() => expect(screen.getByTestId("agents-panel")).toBeTruthy());
    fireEvent.click(node("ag-cr"));
    expect(showToast).toHaveBeenCalledWith("`code-reviewer` did not run in this run.");
    expect(detailId()).toBeNull();
  });

  it("panel is 360px wide and the graph row grows while a run is shown (Q1/Q2)", async () => {
    render(<DependencyGraph artifacts={artifacts} onEditArtifact={() => {}} projectId="p1" projectName="P" />);
    await waitFor(() => expect(screen.getByTestId("agents-panel")).toBeTruthy());
    const wrapper = screen.getByTestId("agents-panel").parentElement!;
    expect(wrapper.className).toContain("w-[360px]");
    expect(wrapper.parentElement!.className).toContain("h-[calc(100vh-200px)]");
  });
});

describe("DependencyGraph — terminal run with summary (QA fix F1)", () => {
  beforeEach(() => {
    useRunStore.setState({
      run: { ...runInfo(), status: "completed", endedAt: new Date(T0 + 30_000).toISOString(), exitCode: 0 },
      connection: "idle",
      summary: {
        status: "completed",
        exitCode: 0,
        durationMs: 30_000,
        startedAt: new Date(T0).toISOString(),
        totals: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, fresh: 2 },
        perNode: [],
        filesChanged: [],
        degraded: false,
      },
    } as never);
  });
  afterEach(() => useRunStore.setState({ summary: undefined } as never));

  it("graph agents keep their graphKey (no 'not on graph' for ba); node clicks work", async () => {
    render(<DependencyGraph artifacts={artifacts} onEditArtifact={() => {}} projectId="p1" projectName="P" />);
    await waitFor(() => expect(screen.getByTestId("agents-panel")).toBeTruthy());
    const baRows = [A, B].map((id) => document.querySelector(`[data-agent-id="${id}"]`) as HTMLElement);
    for (const r of baRows) expect(within(r).queryByText("not on graph")).toBeNull();
    // Explore / general-purpose are not graph agents -> still tagged
    expect(within(document.querySelector('[data-agent-id="toolu_C_explore"]') as HTMLElement).getByText("not on graph")).toBeTruthy();

    // 2 instances -> picker
    fireEvent.click(node("ag-ba"));
    const picker = screen.getByRole("listbox", { name: "ba instances" });
    fireEvent.click(within(picker).getAllByRole("option")[1]!);
    expect(detailId()).toBe(B);
    // 0 instances -> toast
    fireEvent.click(node("ag-cr"));
    expect(showToast).toHaveBeenCalledWith("`code-reviewer` did not run in this run.");
    // command node -> root
    fireEvent.click(node("cmd-1"));
    expect(detailId()).toBe("root");
    await waitFor(() => expect(node("cmd-1").querySelector("[data-run-halo='selected']")).not.toBeNull());
  });

  it("1 instance opens its detail", async () => {
    const one = toEvents(syntheticLines()).slice(0, 4); // init, thinking, text, A dispatched (B not yet)
    useRunStore.setState({ allEvents: one, foldState: foldAll(one), agentTree: foldAgentTreeBatch(initAgentTree(), one) } as never);
    render(<DependencyGraph artifacts={artifacts} onEditArtifact={() => {}} projectId="p1" projectName="P" />);
    await waitFor(() => expect(screen.getByTestId("agents-panel")).toBeTruthy());
    fireEvent.click(node("ag-ba"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(detailId()).toBe(A);
  });

  it("authoring is unchanged after the run: nodes not dimmed, toolbar enabled", async () => {
    render(<DependencyGraph artifacts={artifacts} onEditArtifact={() => {}} projectId="p1" projectName="P" />);
    await waitFor(() => expect(screen.getByTestId("agents-panel")).toBeTruthy());
    for (const id of ["cmd-1", "ag-ba", "ag-cr"]) {
      const inner = node(id).querySelector("div[style*='opacity']") as HTMLElement | null;
      expect(inner?.style.opacity ?? "1").toBe("1");
    }
    expect((screen.getAllByRole("button", { name: /add/i })[0] as HTMLButtonElement).disabled).toBe(false);
  });
});
