import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GraphCanvas, type GraphCanvasEdge, type GraphCanvasHandle, type GraphCanvasNode } from "./GraphCanvas";

function TestNode({ data }: { data: { label: string } }) {
  return <div data-testid={`node-${data.label}`}>{data.label}</div>;
}

const nodeTypes = { command: TestNode, agent: TestNode, missingAgent: TestNode };

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
});
