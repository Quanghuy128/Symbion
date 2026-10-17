import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useConnectDrag } from "./useConnectDrag";
import type { Rect } from "./graphGeometry";

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

describe("useConnectDrag", () => {
  beforeEach(() => {
    // rAF-throttling: run the callback synchronously so tests don't need to
    // wait a real frame — still exercises the "scheduled once per burst" path
    // since useConnectDrag only calls rAF if none is already pending.
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
    const nodeRects = new Map<string, Rect>([
      ["cmd-1", { x: 0, y: 0, width: 160, height: 40 }],
      ["agent-1", { x: 300, y: 0, width: 160, height: 40 }],
      ["cmd-2", { x: 0, y: 100, width: 160, height: 40 }],
    ]);
    const isValidConnection = vi.fn((source: string, target: string) => target === "agent-1");
    const onConnectAttempt = vi.fn();
    const containerRef = makeContainerRef({ left: 0, top: 0 });
    const { result } = renderHook(() =>
      useConnectDrag({
        nodeRects,
        isValidConnection,
        onConnectAttempt,
        disabled: overrides?.disabled ?? false,
        daemonConnected: overrides?.daemonConnected ?? true,
        containerRef,
      })
    );
    return { result, isValidConnection, onConnectAttempt };
  }

  it("T-3.1: mousedown-equivalent startDrag transitions to dragging with {sourceId, cursor}", () => {
    const { result } = setup();
    act(() => result.current.startDrag("cmd-1", 10, 20));
    expect(result.current.dragConnect).toEqual({ sourceId: "cmd-1", cursor: { x: 10, y: 20 } });
  });

  it("T-3.2: mousemove while dragging updates the cursor (final position correct after a burst)", () => {
    const { result } = setup();
    act(() => result.current.startDrag("cmd-1", 0, 0));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 60 }));
    });
    expect(result.current.dragConnect?.cursor).toEqual({ x: 50, y: 60 });
  });

  it("T-3.3: mouseup over a valid target rect fires onConnectAttempt exactly once, resets to idle", () => {
    const { result, onConnectAttempt } = setup();
    act(() => result.current.startDrag("cmd-1", 0, 0));
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 350, clientY: 20 }));
    });
    expect(onConnectAttempt).toHaveBeenCalledTimes(1);
    expect(onConnectAttempt).toHaveBeenCalledWith("cmd-1", "agent-1");
    expect(result.current.dragConnect).toBeNull();
  });

  it("T-3.4: mouseup over an invalid target (isValidConnection false) does NOT call onConnectAttempt, resets", () => {
    const { result, onConnectAttempt } = setup();
    act(() => result.current.startDrag("cmd-1", 0, 0));
    act(() => {
      // cmd-2's rect — isValidConnection mock rejects any non-agent-1 target.
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 50, clientY: 120 }));
    });
    expect(onConnectAttempt).not.toHaveBeenCalled();
    expect(result.current.dragConnect).toBeNull();
  });

  it("T-3.5: mouseup over empty canvas (no matching rect) — no call, clean reset", () => {
    const { result, onConnectAttempt } = setup();
    act(() => result.current.startDrag("cmd-1", 0, 0));
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 900, clientY: 900 }));
    });
    expect(onConnectAttempt).not.toHaveBeenCalled();
    expect(result.current.dragConnect).toBeNull();
  });

  it("T-3.6: Escape key pressed mid-drag cancels, no onConnectAttempt call", () => {
    const { result, onConnectAttempt } = setup();
    act(() => result.current.startDrag("cmd-1", 0, 0));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.dragConnect).toBeNull();
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 350, clientY: 20 }));
    });
    expect(onConnectAttempt).not.toHaveBeenCalled();
  });

  it("T-3.7: disabled=true (authoringSuspended) — mousedown-equivalent startDrag does NOT start a drag", () => {
    const { result } = setup({ disabled: true });
    act(() => result.current.startDrag("cmd-1", 0, 0));
    expect(result.current.dragConnect).toBeNull();
  });

  it("T-3.8: daemon disconnects mid-drag — cancels on the next mouseup rather than firing onConnectAttempt", () => {
    // Simulate the daemon flipping to disconnected mid-drag via a live
    // rerender of the SAME hook instance (not a second, independently-mounted
    // instance — two mounted instances would each register their own
    // `window` listeners and double-fire on a single dispatched event).
    const nodeRects = new Map<string, Rect>([
      ["cmd-1", { x: 0, y: 0, width: 160, height: 40 }],
      ["agent-1", { x: 300, y: 0, width: 160, height: 40 }],
    ]);
    const isValidConnection = vi.fn(() => true);
    const onConnectAttempt = vi.fn();
    const containerRef = makeContainerRef({ left: 0, top: 0 });
    const { result, rerender } = renderHook(
      ({ daemonConnected }: { daemonConnected: boolean }) =>
        useConnectDrag({ nodeRects, isValidConnection, onConnectAttempt, disabled: false, daemonConnected, containerRef }),
      { initialProps: { daemonConnected: true } }
    );
    act(() => result.current.startDrag("cmd-1", 0, 0));
    rerender({ daemonConnected: false });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 350, clientY: 20 }));
    });
    expect(onConnectAttempt).not.toHaveBeenCalled();
    expect(result.current.dragConnect).toBeNull();
  });
});
