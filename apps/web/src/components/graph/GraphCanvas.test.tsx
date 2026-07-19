import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GraphCanvas, type GraphCanvasEdge, type GraphCanvasHandle, type GraphCanvasNode } from "./GraphCanvas";

function TestNode({ data }: { data: { label: string } }) {
  return <div data-testid={`node-${data.label}`}>{data.label}</div>;
}

// Variant that renders a source handle marker (`data-handle-role="source"`)
// so tests can simulate `NodeInteractionBoundary`'s mousedown-capture
// drag-start path (STATE §19 addendum, T-5.9/T-5.10/T-5.11) without pulling
// in the real `NodeHandle`/`CommandNode` components.
function TestNodeWithHandle({ data }: { data: { label: string } }) {
  return (
    <div data-testid={`node-${data.label}`}>
      {data.label}
      <div role="presentation" data-handle-role="source" />
    </div>
  );
}

// free-node-dragging (testplan §3, T-4.6/T-4.7/T-4.8): a variant with BOTH a
// connect handle AND a data-no-node-drag-marked leaf control, so a single
// test node can exercise all three mousedown-origin branches.
function TestNodeWithHandleAndNoDragButton({ data }: { data: { label: string } }) {
  return (
    <div data-testid={`node-${data.label}`}>
      {data.label}
      <div role="presentation" data-handle-role="source" data-testid="handle" />
      <button type="button" data-no-node-drag data-testid="no-drag-btn">
        ⋯
      </button>
    </div>
  );
}

const nodeTypes = { command: TestNode, agent: TestNode, missingAgent: TestNode };
const nodeTypesWithHandle = { command: TestNodeWithHandle, agent: TestNode, missingAgent: TestNode };
const nodeTypesWithHandleAndNoDrag = {
  command: TestNodeWithHandleAndNoDragButton,
  agent: TestNode,
  missingAgent: TestNode,
};

function baseNodes(): GraphCanvasNode[] {
  return [
    { id: "cmd-1", type: "command", position: { x: 0, y: 0 }, width: 160, height: 40, data: { label: "cmd-1" } },
    { id: "agent-1", type: "agent", position: { x: 300, y: 0 }, width: 160, height: 40, data: { label: "agent-1" } },
  ];
}

function baseEdges(): GraphCanvasEdge[] {
  return [{ id: "cmd-1->agent-1", source: "cmd-1", target: "agent-1", data: { interactive: true } }];
}

function renderCanvas(overrides?: Partial<React.ComponentProps<typeof GraphCanvas>>) {
  const onConnectAttempt = vi.fn();
  const isValidConnection = vi.fn(() => true);
  const onNodeHover = vi.fn();
  const onEdgeClick = vi.fn();
  const onPaneClick = vi.fn();
  const onPaneContextMenu = vi.fn();
  const ref = createRef<GraphCanvasHandle>();
  const utils = render(
    <GraphCanvas
      ref={ref}
      nodes={baseNodes()}
      edges={baseEdges()}
      nodeTypes={nodeTypes}
      onConnectAttempt={onConnectAttempt}
      isValidConnection={isValidConnection}
      onNodeHover={onNodeHover}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onPaneContextMenu={onPaneContextMenu}
      disabled={false}
      daemonConnected
      {...overrides}
    />
  );
  return { ...utils, ref, onConnectAttempt, isValidConnection, onNodeHover, onEdgeClick, onPaneClick, onPaneContextMenu };
}

describe("GraphCanvas", () => {
  beforeEach(() => {
    // Same rAF-synchronous mock used by useConnectDrag.test.ts — throttled
    // mousemove updates need to flush within the test's own tick, jsdom's
    // real requestAnimationFrame never fires without a live render loop.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T-5.1: renders N nodes at their given positions (style.left/top match input position)", () => {
    renderCanvas();
    const wrapper = screen.getByTestId("node-cmd-1").closest("[data-node-id]") as HTMLElement;
    expect(wrapper.style.left).toBe("0px");
    expect(wrapper.style.top).toBe("0px");
    const agentWrapper = screen.getByTestId("node-agent-1").closest("[data-node-id]") as HTMLElement;
    expect(agentWrapper.style.left).toBe("300px");
  });

  it("T-5.2: renders edges as <path> elements (plus the 20px hit-area for interactive edges)", () => {
    const { container } = renderCanvas();
    const paths = container.querySelectorAll("path");
    // one visible path + one 20px hit-area path (interactive: true) = 2.
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it("T-5.3: clicking empty canvas area fires onPaneClick; not fired when clicking a node", () => {
    const { onPaneClick, container } = renderCanvas();
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onPaneClick).toHaveBeenCalledTimes(1);

    onPaneClick.mockClear();
    fireEvent.click(screen.getByTestId("node-cmd-1"));
    // node's own wrapper stopPropagation()s the click before it reaches the pane.
    expect(onPaneClick).not.toHaveBeenCalled();
  });

  it("T-5.4/5.5: right-clicking empty canvas fires onPaneContextMenu; right-clicking a node does not", () => {
    const { onPaneContextMenu, container } = renderCanvas();
    const root = container.firstChild as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 1010,
      bottom: 1020,
      width: 1000,
      height: 1000,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    fireEvent.contextMenu(root, { clientX: 60, clientY: 90 });
    expect(onPaneContextMenu).toHaveBeenCalledWith(50, 70);

    onPaneContextMenu.mockClear();
    fireEvent.contextMenu(screen.getByTestId("node-cmd-1"));
    expect(onPaneContextMenu).not.toHaveBeenCalled();
  });

  it("T-5.6: disabled=true suppresses hover/context-menu handlers (authoring hard-hide)", () => {
    const { onNodeHover, onPaneContextMenu, container } = renderCanvas({ disabled: true });
    fireEvent.mouseEnter(screen.getByTestId("node-cmd-1"));
    expect(onNodeHover).not.toHaveBeenCalled();
    fireEvent.contextMenu(container.firstChild as HTMLElement);
    expect(onPaneContextMenu).not.toHaveBeenCalled();
  });

  it("T-5.8: fitView() imperative call triggers a scroll (scroll-based replacement, no transform state — PLAN §9.3 Q1)", () => {
    const { ref, container } = renderCanvas();
    const root = container.firstChild as HTMLElement;
    const scrollToSpy = vi.fn();
    // jsdom doesn't implement scrollTo by default.
    Object.defineProperty(root, "scrollTo", { value: scrollToSpy, writable: true });
    ref.current?.fitView();
    expect(scrollToSpy).toHaveBeenCalled();
  });

  it("T-5.9: connect-drag cursor far outside the node bounding box expands the SVG's width/height (regression for STATE §18/§19 clipping bug)", () => {
    const smallNodes: GraphCanvasNode[] = [
      { id: "cmd-1", type: "command", position: { x: 0, y: 0 }, width: 160, height: 40, data: { label: "cmd-1" } },
      { id: "agent-1", type: "agent", position: { x: 0, y: 0 }, width: 160, height: 40, data: { label: "agent-1" } },
    ];
    const { container } = renderCanvas({ nodes: smallNodes, edges: [], nodeTypes: nodeTypesWithHandle });
    const root = container.firstChild as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const handle = container.querySelector('[data-handle-role="source"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 10, clientY: 10 });

    // mousemove to a point far outside the node bounding box (x:0-160, y:0-40).
    fireEvent(window, new MouseEvent("mousemove", { clientX: 900, clientY: 700 }));

    // The DotGridBackground renders its OWN <svg> first (z-index 0); the
    // edge layer is the second <svg> in DOM order (z-index 1) — select it
    // explicitly rather than relying on document order alone being stable.
    const svgs = container.querySelectorAll("svg");
    const svg = svgs[svgs.length - 1] as SVGSVGElement;
    expect(parseFloat(svg.style.width)).toBeGreaterThanOrEqual(900);
    expect(parseFloat(svg.style.height)).toBeGreaterThanOrEqual(700);

    fireEvent(window, new MouseEvent("mouseup", { clientX: 900, clientY: 700 }));
  });

  it("T-5.10: SVG width/height shrink back to the plain node bounding box after the drag ends", () => {
    const smallNodes: GraphCanvasNode[] = [
      { id: "cmd-1", type: "command", position: { x: 0, y: 0 }, width: 160, height: 40, data: { label: "cmd-1" } },
      { id: "agent-1", type: "agent", position: { x: 0, y: 0 }, width: 160, height: 40, data: { label: "agent-1" } },
    ];
    const { container } = renderCanvas({ nodes: smallNodes, edges: [], nodeTypes: nodeTypesWithHandle });
    const root = container.firstChild as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const handle = container.querySelector('[data-handle-role="source"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 10, clientY: 10 });
    fireEvent(window, new MouseEvent("mousemove", { clientX: 900, clientY: 700 }));

    // The DotGridBackground renders its OWN <svg> first (z-index 0); the
    // edge layer is the second <svg> in DOM order (z-index 1).
    const svgs = container.querySelectorAll("svg");
    const svg = svgs[svgs.length - 1] as SVGSVGElement;
    expect(parseFloat(svg.style.width)).toBeGreaterThanOrEqual(900);

    // End the drag — bounds should collapse back to the plain node bounding
    // box (maxX=160, maxY=40 -> +40 padding per GraphCanvas's width/height calc).
    fireEvent(window, new MouseEvent("mouseup", { clientX: 900, clientY: 700 }));

    expect(parseFloat(svg.style.width)).toBeLessThan(900);
    expect(parseFloat(svg.style.width)).toBeCloseTo(200, 0); // 160 + 40
    expect(parseFloat(svg.style.height)).toBeCloseTo(80, 0); // 40 + 40
  });

  it("T-5.11: dragging toward negative-x/negative-y coordinates renders a ghost path without throwing (smoke; full clip confirmation is live-browser QA, J27)", () => {
    const smallNodes: GraphCanvasNode[] = [
      { id: "cmd-1", type: "command", position: { x: 300, y: 300 }, width: 160, height: 40, data: { label: "cmd-1" } },
      { id: "agent-1", type: "agent", position: { x: 300, y: 300 }, width: 160, height: 40, data: { label: "agent-1" } },
    ];
    const { container } = renderCanvas({ nodes: smallNodes, edges: [], nodeTypes: nodeTypesWithHandle });
    const root = container.firstChild as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const handle = container.querySelector('[data-handle-role="source"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 310, clientY: 310 });

    expect(() => {
      fireEvent(window, new MouseEvent("mousemove", { clientX: -200, clientY: -100 }));
    }).not.toThrow();

    // The ghost path's `d` attribute should end at the negative local point —
    // confirms the code path doesn't silently clamp negative extraPoints to 0.
    const paths = Array.from(container.querySelectorAll("svg path"));
    const ghost = paths.find((p) => p.getAttribute("d")?.includes("-200") && p.getAttribute("d")?.includes("-100"));
    expect(ghost).toBeDefined();

    fireEvent(window, new MouseEvent("mouseup", { clientX: -200, clientY: -100 }));
  });

  it("E10 (T-7.2 analog): GraphCanvas holds NO useState/useReducer copy of nodes/edges — re-render with new props reflects immediately", () => {
    const { rerender } = renderCanvas();
    expect(screen.getByTestId("node-cmd-1")).toBeInTheDocument();

    const updatedNodes: GraphCanvasNode[] = [
      { id: "cmd-1", type: "command", position: { x: 0, y: 0 }, width: 160, height: 40, data: { label: "cmd-1-RENAMED" } },
    ];
    rerender(
      <GraphCanvas
        nodes={updatedNodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onConnectAttempt={vi.fn()}
        isValidConnection={() => true}
        onNodeHover={vi.fn()}
        onEdgeClick={vi.fn()}
        onPaneClick={vi.fn()}
        onPaneContextMenu={vi.fn()}
        disabled={false}
        daemonConnected
      />
    );
    expect(screen.getByTestId("node-cmd-1-RENAMED")).toBeInTheDocument();
    expect(screen.queryByTestId("node-cmd-1")).not.toBeInTheDocument();
  });

  // free-node-dragging (testplan §3, PLAN §6) — NodeInteractionBoundary
  // dispatch-boundary tests.
  it("T-4.6: mousedown on a connect-handle element fires connect-drag start, NOT node-drag (AC-5)", () => {
    const onNodeDragCommit = vi.fn();
    const { container } = renderCanvas({ nodes: [{ ...baseNodes()[0]!, position: { x: 0, y: 0 } }], edges: [], nodeTypes: nodeTypesWithHandle, onNodeDragCommit });
    const handle = container.querySelector('[data-handle-role="source"]') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 10, clientY: 10 });

    // Connect-drag started: mousemove renders a ghost <path> (proof
    // useConnectDrag's dragConnect state entered) — node-drag never entered
    // (the node stays at its original position; no drag overlay z-index).
    fireEvent(window, new MouseEvent("mousemove", { clientX: 50, clientY: 50 }));
    const svgs = container.querySelectorAll("svg");
    const svg = svgs[svgs.length - 1] as SVGSVGElement;
    const ghost = Array.from(svg.querySelectorAll("path")).find((p) => p.getAttribute("stroke-dasharray"));
    expect(ghost).toBeDefined();

    fireEvent(window, new MouseEvent("mouseup", { clientX: 50, clientY: 50 }));
    // node-drag's commit callback must never have fired for a connect-handle mousedown.
    expect(onNodeDragCommit).not.toHaveBeenCalled();
  });

  it("T-4.7: mousedown on the plain node body (no data-handle-role, no data-no-node-drag) fires node-drag start, NOT connect-drag", () => {
    const onConnectAttemptSpy = vi.fn();
    const nodes = [{ ...baseNodes()[0]!, position: { x: 0, y: 0 } }];
    const { container } = renderCanvas({
      nodes,
      edges: [],
      nodeTypes: nodeTypesWithHandle,
      onConnectAttempt: onConnectAttemptSpy,
    });
    const nodeBody = screen.getByTestId("node-cmd-1");
    fireEvent.mouseDown(nodeBody, { clientX: 10, clientY: 10 });

    // Move past the drag threshold; the node's wrapper should now render at
    // an offset position (proof node-drag's ephemeral overlay is active).
    fireEvent(window, new MouseEvent("mousemove", { clientX: 60, clientY: 60 }));
    const wrapper = nodeBody.closest("[data-node-id]") as HTMLElement;
    expect(wrapper.style.left).toBe("50px");
    expect(wrapper.style.top).toBe("50px");

    fireEvent(window, new MouseEvent("mouseup", { clientX: 60, clientY: 60 }));
    // No connect-attempt should ever have been triggered by a node-body mousedown.
    expect(onConnectAttemptSpy).not.toHaveBeenCalled();
  });

  it("T-4.8: mousedown on a data-no-node-drag control fires NEITHER gesture (companion-change regression guard)", () => {
    const onNodeDragCommit = vi.fn();
    const nodes = [{ ...baseNodes()[0]!, position: { x: 0, y: 0 } }];
    const { container } = renderCanvas({
      nodes,
      edges: [],
      nodeTypes: nodeTypesWithHandleAndNoDrag,
      onNodeDragCommit,
    });
    const noDragBtn = screen.getByTestId("no-drag-btn");
    fireEvent.mouseDown(noDragBtn, { clientX: 10, clientY: 10 });

    fireEvent(window, new MouseEvent("mousemove", { clientX: 60, clientY: 60 }));
    // Node must NOT have moved (node-drag never started).
    const wrapper = screen.getByTestId("node-cmd-1").closest("[data-node-id]") as HTMLElement;
    expect(wrapper.style.left).toBe("0px");
    expect(wrapper.style.top).toBe("0px");

    // Also confirm no ghost connect-drag path was rendered.
    const svgs = container.querySelectorAll("svg");
    const svg = svgs[svgs.length - 1] as SVGSVGElement;
    const ghost = Array.from(svg.querySelectorAll("path")).find((p) => p.getAttribute("stroke-dasharray"));
    expect(ghost).toBeUndefined();

    fireEvent(window, new MouseEvent("mouseup", { clientX: 60, clientY: 60 }));
    expect(onNodeDragCommit).not.toHaveBeenCalled();
  });
});
