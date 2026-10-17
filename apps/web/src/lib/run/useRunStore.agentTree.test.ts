import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { initAgentTree, type PersistedRunEvent, type RunInfo } from "@symbion/core";
import { syntheticLines, textEvents, toEvents } from "@/components/run/agents/agentsTestUtil";

/** W-10 — the store folds the agent tree incrementally per accepted batch. */
const rpc = vi.fn();
vi.mock("../rpc/client", () => ({
  callRpc: (...args: unknown[]) => rpc(...args),
  getDaemonOrigin: () => "http://127.0.0.1:1",
}));

type Listener = (msg: { data: string }) => void;
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Listener[]>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }
}

const { useRunStore } = await import("./useRunStore");

function runInfo(extra?: Partial<RunInfo>): RunInfo {
  return {
    schemaVersion: 1,
    runId: "r1",
    projectId: "p1",
    artifactId: "a1",
    commandName: "analyze",
    requirement: "x",
    modelOverride: null,
    argv: [],
    bin: "claude",
    cwd: "/tmp",
    permissionMode: "acceptEdits",
    allowedTools: [],
    ceilings: { wallClockMs: 1, tokenCap: 1 },
    cliVersion: "2.1.187",
    sessionId: null,
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(1).toISOString(),
    status: "completed",
    exitCode: 0,
    stopReason: null,
    errorMessage: null,
    gitBefore: { isRepo: true, clean: true, changedFiles: [] },
    filesChanged: [],
    lastSeq: 1500,
    totals: null,
    ...extra,
  };
}

const events = toEvents(syntheticLines());
const latestEs = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]!;

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  FakeEventSource.instances = [];
  rpc.mockReset();
});
afterEach(() => {
  useRunStore.getState().detach();
  vi.unstubAllGlobals();
});

function feed(batches: PersistedRunEvent[][]) {
  useRunStore.getState().attach("p1", "r1", 0);
  for (const b of batches) latestEs().emit("run", { events: b });
  return useRunStore.getState().agentTree;
}

describe("useRunStore agentTree (W-10)", () => {
  it("3 batches vs 1 batch -> identical tree; lastBatchSize tracked", () => {
    const one = feed([events]);
    const three = feed([events.slice(0, 5), events.slice(5, 17), events.slice(17)]);
    expect(three).toEqual(one);
    expect(useRunStore.getState().lastBatchSize).toBe(events.length - 17);
    expect(one.eventCount).toBe(events.length);
  });

  it("reconnect attach(afterSeq>0) keeps the tree; attach(0) resets it; dup frames are ignored", () => {
    const tree = feed([events.slice(0, 10)]);
    useRunStore.getState().attach("p1", "r1", 10);
    expect(useRunStore.getState().agentTree).toBe(tree);
    latestEs().emit("run", { events: events.slice(5, 12) }); // overlapping replay
    expect(useRunStore.getState().agentTree.eventCount).toBe(12);
    useRunStore.getState().attach("p1", "r1", 0);
    expect(useRunStore.getState().agentTree).toEqual(initAgentTree());
    expect(useRunStore.getState().allEvents).toEqual([]);
  });

  it("openHistoryRun pages 3×500 -> history tree from all 1,500 events; timeline keys are gone", async () => {
    const all = textEvents(1_500);
    rpc.mockImplementation((method: string, params: { afterSeq: number }) => {
      if (method !== "getRunEvents") return Promise.resolve({});
      const page = all.filter((e) => e.seq > params.afterSeq).slice(0, 500);
      return Promise.resolve({ events: page, run: runInfo(), done: page.length < 500 || page[page.length - 1]!.seq === 1_500 });
    });
    await useRunStore.getState().openHistoryRun("p1", "r1");
    const st = useRunStore.getState();
    expect(rpc.mock.calls.filter((c) => c[0] === "getRunEvents")).toHaveLength(3);
    expect(st.historyEvents).toHaveLength(1_500);
    expect(st.historyAgentTree.eventCount).toBe(1_500);
    expect(st.historyAgentTree.lastSeq).toBe(1_500);
    expect(st.historyFoldState.lastSeq).toBe(1_500);
    expect("timeline" in st).toBe(false);
    expect("historyTimeline" in st).toBe(false);
    useRunStore.getState().exitHistory();
    expect(useRunStore.getState().historyEvents).toEqual([]);
  });

  it("review fix #6: a slower earlier openHistoryRun(A) never overwrites a later openHistoryRun(B)", async () => {
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((r) => (releaseA = r));
    const evA = textEvents(3);
    const evB = textEvents(5);
    rpc.mockImplementation(async (method: string, params: { runId: string }) => {
      if (method !== "getRunEvents") return {};
      if (params.runId === "rA") {
        await gateA;
        return { events: evA, run: runInfo({ runId: "rA", lastSeq: 3 }), done: true };
      }
      return { events: evB, run: runInfo({ runId: "rB", lastSeq: 5 }), done: true };
    });
    const pA = useRunStore.getState().openHistoryRun("p1", "rA");
    await useRunStore.getState().openHistoryRun("p1", "rB");
    releaseA();
    await pA;
    const st = useRunStore.getState();
    expect(st.historyRunId).toBe("rB");
    expect(st.historyRun?.runId).toBe("rB");
    expect(st.historyAgentTree.eventCount).toBe(5);
    useRunStore.getState().exitHistory();
  });
});
