import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { CanonicalArtifact } from "@symbion/core";
import { DependencyGraph } from "./DependencyGraph";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

// free-node-dragging testplan §4 (T-5.1/T-5.2/T-5.3) — jsdom-level proxy for
// AC-1/AC-2/AC-4: asserts on rendered `position` style values / RPC-call
// spies, not actual pixel rendering or drag-and-drop event realism (that's
// testplan §5's genuinely-requires-a-browser section).
//
// `callRpc` is mocked at the module boundary — both `DependencyGraph.tsx`
// (getNodeLayout/setNodeLayout) and `useRunStore.ts` (listRuns, called by
// attachIfActive/listRunsForHistory on mount) import the SAME function from
// "@/lib/rpc/client", so one mock dispatches by `method`.
const getNodeLayoutMock = vi.fn();
const setNodeLayoutMock = vi.fn();

vi.mock("@/lib/rpc/client", () => ({
  callRpc: vi.fn((method: string, params: unknown) => {
    if (method === "getNodeLayout") return getNodeLayoutMock(params);
    if (method === "setNodeLayout") return setNodeLayoutMock(params);
    if (method === "listRuns") return Promise.resolve({ runs: [] });
    return Promise.resolve({});
  }),
}));

// computeLayout is mocked so its output is deliberately DIFFERENT from any
// override, proving in T-5.1 that an override wins over whatever dagre
// would have computed.
vi.mock("./graph/computeLayout", () => ({
  computeLayout: vi.fn((nodes: Array<{ id: string }>) => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of nodes) map.set(n.id, { x: 999, y: 999 });
    return map;
  }),
}));

// setNodeLayout retry enhancement (testplan §7, T-7.1..T-7.7): capture the
// `onNodeDragCommit`/`onNodeDragDaemonDisconnected` callbacks DependencyGraph
// passes into GraphCanvas so tests can invoke them directly (simulating a
// mouseup-commit) without needing real pointer-event drag simulation, which
// belongs to GraphCanvas's own test suite, not this component-integration
// layer (testplan §4's own framing: assert on RPC-call spies/state, not
// pixel-level drag realism).
let capturedOnNodeDragCommit:
  | ((nodeId: string, position: { x: number; y: number }) => void)
  | undefined;
let capturedOnNodeDragDaemonDisconnected:
  | ((nodeId: string, position: { x: number; y: number }) => void)
  | undefined;

vi.mock("./graph/GraphCanvas", async () => {
  const React = await import("react");
  const actual = await vi.importActual<typeof import("./graph/GraphCanvas")>("./graph/GraphCanvas");
  const RealGraphCanvas = actual.GraphCanvas;
  const Wrapped = React.forwardRef<unknown, Record<string, unknown>>(function WrappedGraphCanvas(props, ref) {
    capturedOnNodeDragCommit = props.onNodeDragCommit as typeof capturedOnNodeDragCommit;
    capturedOnNodeDragDaemonDisconnected =
      props.onNodeDragDaemonDisconnected as typeof capturedOnNodeDragDaemonDisconnected;
    return React.createElement(RealGraphCanvas, { ...props, ref } as never);
  });
  return { ...actual, GraphCanvas: Wrapped };
});

function makeCommand(id: string, name: string): CanonicalArtifact {
  return {
    id,
    kind: "command",
    name,
    description: "d",
    body: "body",
    meta: { version: "draft", status: "draft", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  };
}

function nodeWrapper(label: string): HTMLElement {
  return screen.getByText(label).closest("[data-node-id]") as HTMLElement;
}

describe("DependencyGraph — layout-override integration (testplan §4)", () => {
  beforeEach(() => {
    useArtifactStore.setState({ daemonConnected: true });
    getNodeLayoutMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("T-5.1: a stubbed getNodeLayout override wins over the (mocked, deliberately different) computeLayout position", async () => {
    getNodeLayoutMock.mockResolvedValue({ positions: { "cmd-1": { x: 42, y: 84 } } });
    const artifacts = [makeCommand("cmd-1", "alpha")];

    render(
      <DependencyGraph
        artifacts={artifacts}
        onEditArtifact={() => {}}
        projectId="proj-1"
        projectName="Proj"
      />
    );

    await waitFor(() => {
      const wrapper = nodeWrapper("/alpha");
      expect(wrapper.style.left).toBe("42px");
      expect(wrapper.style.top).toBe("84px");
    });
  });

  it("T-5.2: a NEW artifact (absent from the override map) gets the computeLayout position; the overridden node is unchanged", async () => {
    getNodeLayoutMock.mockResolvedValue({ positions: { "cmd-1": { x: 42, y: 84 } } });
    const artifacts = [makeCommand("cmd-1", "alpha"), makeCommand("cmd-2", "beta")];

    render(
      <DependencyGraph
        artifacts={artifacts}
        onEditArtifact={() => {}}
        projectId="proj-1"
        projectName="Proj"
      />
    );

    await waitFor(() => {
      const overridden = nodeWrapper("/alpha");
      expect(overridden.style.left).toBe("42px");
      expect(overridden.style.top).toBe("84px");

      const fresh = nodeWrapper("/beta");
      expect(fresh.style.left).toBe("999px");
      expect(fresh.style.top).toBe("999px");
    });
  });

  it("T-5.3: getNodeLayout rejecting does not crash — DependencyGraph still renders, treating overrides as empty", async () => {
    getNodeLayoutMock.mockRejectedValue(new Error("daemon offline"));
    const artifacts = [makeCommand("cmd-1", "alpha")];

    expect(() =>
      render(
        <DependencyGraph
          artifacts={artifacts}
          onEditArtifact={() => {}}
          projectId="proj-1"
          projectName="Proj"
        />
      )
    ).not.toThrow();

    await waitFor(() => {
      const wrapper = nodeWrapper("/alpha");
      // falls back to the (mocked) computeLayout position, not a crash/blank render.
      expect(wrapper.style.left).toBe("999px");
      expect(wrapper.style.top).toBe("999px");
    });
  });
});

// setNodeLayout retry enhancement (testplan §7, T-7.1..T-7.7). Drag commits
// are simulated by invoking the `onNodeDragCommit`/`onNodeDragDaemonDisconnected`
// callbacks captured from the (wrapped-but-real) GraphCanvas directly, rather
// than synthesizing real pointer-drag DOM events — that gesture-level
// behavior is GraphCanvas/useNodeDrag's own test suite's job (testplan §3);
// this layer only needs to prove the retry/supersession/toast CONTRACT.
describe("DependencyGraph — setNodeLayout retry enhancement (testplan §7)", () => {
  let toastSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastSpy = vi.fn();
    // showToast is set BEFORE render so the captured onNodeDragCommit/
    // onNodeDragDaemonDisconnected callbacks close over the spy from the
    // start — avoids relying on a re-render to pick up a later state swap.
    useArtifactStore.setState({ daemonConnected: true, showToast: toastSpy });
    getNodeLayoutMock.mockReset();
    getNodeLayoutMock.mockResolvedValue({ positions: {} });
    setNodeLayoutMock.mockReset();
    capturedOnNodeDragCommit = undefined;
    capturedOnNodeDragDaemonDisconnected = undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function renderGraph(artifacts: CanonicalArtifact[] = [makeCommand("cmd-1", "alpha")]) {
    render(
      <DependencyGraph
        artifacts={artifacts}
        onEditArtifact={() => {}}
        projectId="proj-1"
        projectName="Proj"
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(capturedOnNodeDragCommit).toBeDefined();
  }

  it("T-7.1: retry-then-succeed silently — 2nd call resolves, no toast, override reconciles to the 2nd call's result", async () => {
    await renderGraph();

    setNodeLayoutMock
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ positions: { "cmd-1": { x: 10, y: 20 } } });

    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 5, y: 5 });
      await Promise.resolve();
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(setNodeLayoutMock).toHaveBeenCalledTimes(2);
    expect(toastSpy).not.toHaveBeenCalled();

    const wrapper = nodeWrapper("/alpha");
    expect(wrapper.style.left).toBe("10px");
    expect(wrapper.style.top).toBe("20px");
  });

  it("T-7.2: exhausts all 3 attempts, toast shown exactly once", async () => {
    await renderGraph();

    setNodeLayoutMock.mockRejectedValue(new Error("down"));

    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 5, y: 5 });
      await Promise.resolve();
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(3);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith("Position not saved — try again.", "error");
  });

  it("T-7.3: daemon disconnects mid-retry — aborts early, only 1 call, toast fires promptly", async () => {
    await renderGraph();

    setNodeLayoutMock.mockRejectedValue(new Error("transient"));

    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 5, y: 5 });
      await Promise.resolve();
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(1);

    // Daemon goes down before the scheduled retry fires.
    await act(async () => {
      useArtifactStore.setState({ daemonConnected: false });
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // The retry loop must not have attempted a 2nd call.
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith("Position not saved — try again.", "error");
  });

  it("T-7.4: same-node supersession — only the newer commit's outcome is visible", async () => {
    await renderGraph();

    let resolveFirstRetry: (value: { positions: Record<string, { x: number; y: number }> }) => void;
    setNodeLayoutMock
      .mockRejectedValueOnce(new Error("transient")) // 1st commit, attempt 1: fails
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRetry = resolve;
          })
      ) // 1st commit, attempt 2: pending until we resolve it below (stale by then)
      .mockResolvedValueOnce({ positions: { "cmd-1": { x: 200, y: 200 } } }); // 2nd commit's own call

    // First (soon-to-be-stale) commit.
    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 1, y: 1 });
      await Promise.resolve();
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(1);

    // Let attempt 1 fail and attempt 2 start (now pending on resolveFirstRetry).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(2);

    // Second (newer) commit for the SAME nodeId, before the first's retry resolves.
    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 2, y: 2 });
      await Promise.resolve();
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(3);

    // Second commit's own call resolves immediately (already mocked above).
    await act(async () => {
      await Promise.resolve();
    });

    const wrapperAfterSecond = nodeWrapper("/alpha");
    expect(wrapperAfterSecond.style.left).toBe("200px");
    expect(wrapperAfterSecond.style.top).toBe("200px");
    expect(toastSpy).not.toHaveBeenCalled();

    // Now let the FIRST (stale, superseded) commit's pending retry resolve with
    // a stale position — must be silently dropped: no state change, no toast.
    await act(async () => {
      resolveFirstRetry!({ positions: { "cmd-1": { x: 999, y: 999 } } });
      await Promise.resolve();
    });

    const wrapperFinal = nodeWrapper("/alpha");
    expect(wrapperFinal.style.left).toBe("200px");
    expect(wrapperFinal.style.top).toBe("200px");
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("T-7.4b: a superseded commit's eventual FAILURE (all attempts exhausted) is also silently dropped", async () => {
    await renderGraph();

    let rejectFirstRetry: (err: unknown) => void;
    setNodeLayoutMock
      .mockRejectedValueOnce(new Error("transient")) // 1st commit, attempt 1
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirstRetry = reject;
          })
      ) // 1st commit, attempt 2: pending
      .mockResolvedValueOnce({ positions: { "cmd-1": { x: 300, y: 300 } } }); // 2nd commit's own call

    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 1, y: 1 });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(setNodeLayoutMock).toHaveBeenCalledTimes(2);

    // Supersede with a newer commit.
    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 2, y: 2 });
      await Promise.resolve();
    });
    expect(toastSpy).not.toHaveBeenCalled();

    // The first commit's pending (2nd) attempt now rejects, exhausting its
    // own 3 attempts eventually — but since it's superseded, no toast.
    await act(async () => {
      rejectFirstRetry!(new Error("still down"));
      await Promise.resolve();
    });
    // Give any further internal retry scheduling a chance to flush.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(toastSpy).not.toHaveBeenCalled();
    const wrapper = nodeWrapper("/alpha");
    expect(wrapper.style.left).toBe("300px");
    expect(wrapper.style.top).toBe("300px");
  });

  it("T-7.5: independent per-node retries — dragging two different nodes doesn't cross-contaminate", async () => {
    await renderGraph([makeCommand("cmd-1", "alpha"), makeCommand("cmd-2", "beta")]);

    // Mirrors the real daemon's upsert contract (PLAN §3): setNodeLayout's
    // result is the FULL updated positions map, not just the changed key —
    // simulated here via a shared accumulator so this test doesn't produce a
    // false failure from the client's existing "reconcile with the server's
    // full returned map" behavior (a real daemon would never drop unrelated
    // keys on a single-key upsert).
    const serverPositions: Record<string, { x: number; y: number }> = {};
    setNodeLayoutMock.mockImplementation((params: unknown) => {
      const { nodeId, position } = params as { nodeId: string; position: { x: number; y: number } };
      serverPositions[nodeId] = position;
      return Promise.resolve({ positions: { ...serverPositions } });
    });

    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 11, y: 11 });
      capturedOnNodeDragCommit!("cmd-2", { x: 22, y: 22 });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(setNodeLayoutMock).toHaveBeenCalledTimes(2);
    expect(toastSpy).not.toHaveBeenCalled();

    const alpha = nodeWrapper("/alpha");
    expect(alpha.style.left).toBe("11px");
    expect(alpha.style.top).toBe("11px");

    const beta = nodeWrapper("/beta");
    expect(beta.style.left).toBe("22px");
    expect(beta.style.top).toBe("22px");
  });

  it("T-7.6: first attempt succeeds — no regression, exactly one call, no retry overhead", async () => {
    await renderGraph();

    setNodeLayoutMock.mockResolvedValue({ positions: { "cmd-1": { x: 7, y: 8 } } });

    await act(async () => {
      capturedOnNodeDragCommit!("cmd-1", { x: 7, y: 8 });
      await Promise.resolve();
    });

    expect(setNodeLayoutMock).toHaveBeenCalledTimes(1);
    expect(toastSpy).not.toHaveBeenCalled();

    const wrapper = nodeWrapper("/alpha");
    expect(wrapper.style.left).toBe("7px");
    expect(wrapper.style.top).toBe("8px");
  });

  it("T-7.7: handleNodeDragDaemonDisconnected never enters the retry loop / never calls setNodeLayout", async () => {
    await renderGraph();
    expect(capturedOnNodeDragDaemonDisconnected).toBeDefined();

    await act(async () => {
      capturedOnNodeDragDaemonDisconnected!("cmd-1", { x: 3, y: 3 });
      await Promise.resolve();
    });

    expect(setNodeLayoutMock).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      "Daemon offline — position won't be saved until reconnected.",
      "warning"
    );

    const wrapper = nodeWrapper("/alpha");
    expect(wrapper.style.left).toBe("3px");
    expect(wrapper.style.top).toBe("3px");
  });
});
