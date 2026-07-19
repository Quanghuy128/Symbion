import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNodeDrag } from "./useNodeDrag";

function makeContainerRef(rect: { left: number; top: number }) {
  const el = document.createElement("div");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: rect.left,
    top: rect.top,
    right: rect.left + 1000,
    bottom: rect.top + 1000,
    width: 1000,
    height: 1000,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
  return { current: el };
}

describe("useNodeDrag", () => {
  beforeEach(() => {
    // rAF-throttling: run the callback synchronously, same convention as
    // useConnectDrag.test.ts.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup(overrides?: Partial<{ daemonConnected: boolean; disabled: boolean }>) {
    const containerRef = makeContainerRef({ left: 0, top: 0 });
    const onCommitPosition = vi.fn();
    const onDaemonDisconnectedCommit = vi.fn();
    const { result } = renderHook(() =>
      useNodeDrag({
        disabled: overrides?.disabled ?? false,
        daemonConnected: overrides?.daemonConnected ?? true,
        containerRef,
        onCommitPosition,
        onDaemonDisconnectedCommit,
      })
    );
    return { result, onCommitPosition, onDaemonDisconnectedCommit };
  }

  it("T-4.1: below-threshold movement then mouseup — no onCommitPosition call (a click, not a drag)", () => {
    const { result, onCommitPosition } = setup();
    act(() => result.current.startDrag("node-1", { x: 10, y: 20 }, 100, 100));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 101, clientY: 101 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 101, clientY: 101 }));
    });
    expect(onCommitPosition).not.toHaveBeenCalled();
    expect(result.current.dragState).toBeNull();
  });

  it("T-4.2: movement past the threshold then mouseup — onCommitPosition fires exactly once with the final position", () => {
    const { result, onCommitPosition } = setup();
    act(() => result.current.startDrag("node-1", { x: 10, y: 20 }, 100, 100));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 160 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 150, clientY: 160 }));
    });
    expect(onCommitPosition).toHaveBeenCalledTimes(1);
    // delta (50, 60) applied to the starting canvas position (10, 20).
    expect(onCommitPosition).toHaveBeenCalledWith("node-1", { x: 60, y: 80 });
    expect(result.current.dragState).toBeNull();
  });

  it("T-4.3: Escape mid-drag cancels — no onCommitPosition call, dragState reverts to null", () => {
    const { result, onCommitPosition } = setup();
    act(() => result.current.startDrag("node-1", { x: 10, y: 20 }, 100, 100));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 160 }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.dragState).toBeNull();
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 150, clientY: 160 }));
    });
    expect(onCommitPosition).not.toHaveBeenCalled();
  });

  it("T-4.4: disabled=true — startDrag is a no-op, no drag state ever enters", () => {
    const { result } = setup({ disabled: true });
    act(() => result.current.startDrag("node-1", { x: 10, y: 20 }, 100, 100));
    expect(result.current.dragState).toBeNull();
  });

  it("T-4.5: daemonConnected=false at mouseup — local commit still happens via onDaemonDisconnectedCommit, NOT onCommitPosition", () => {
    const { result, onCommitPosition, onDaemonDisconnectedCommit } = setup({ daemonConnected: false });
    act(() => result.current.startDrag("node-1", { x: 10, y: 20 }, 100, 100));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 160 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 150, clientY: 160 }));
    });
    expect(onCommitPosition).not.toHaveBeenCalled();
    expect(onDaemonDisconnectedCommit).toHaveBeenCalledTimes(1);
    expect(onDaemonDisconnectedCommit).toHaveBeenCalledWith("node-1", { x: 60, y: 80 });
  });
});
