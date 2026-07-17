"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { DotGridBackground } from "./DotGridBackground";
import { GraphEdgePath, type AnimatedEdgeData } from "./GraphEdgePath";
import { GraphEdgeLabel } from "./GraphEdgeLabel";
import { GraphNode } from "./GraphNode";
import { useConnectDrag } from "./useConnectDrag";
import { useEdgeInteraction } from "./useEdgeInteraction";
import { boundingBox, nodeRect, sourceAnchor, targetAnchor, type GeometryNode } from "./graphGeometry";

export interface GraphCanvasNode extends GeometryNode {
  type: "command" | "agent" | "missingAgent";
  data: Record<string, unknown>;
}

export interface GraphCanvasEdge {
  id: string;
  source: string;
  target: string;
  data?: AnimatedEdgeData;
}

export interface GraphCanvasHandle {
  fitView(): void;
}

/**
 * Leaf node component contract (`CommandNode`/`AgentNode`/`MissingAgentNode`):
 * each takes `data` typed to ITS OWN concrete `*NodeData` shape (e.g.
 * `CommandNodeData`), not the generic `Record<string, unknown>` bag
 * `GraphCanvasNode.data` carries. `nodeTypes` is intentionally loosely typed
 * here (`data: never` on the function param, widened via a cast at the call
 * site) — the same escape hatch xyflow's own `NodeTypes` map required
 * (`NodeProps<Node<T>>` also needed an unsafe cast internally), since a
 * `Record<string, Component>` keyed union can't statically narrow which
 * concrete `data` shape applies to which key without a discriminated-union
 * component map, which the pre-migration `nodeTypes` object never had either.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNodeComponent = (props: { data: any }) => ReactNode;

export interface GraphCanvasProps {
  nodes: GraphCanvasNode[];
  edges: GraphCanvasEdge[];
  nodeTypes: Record<string, AnyNodeComponent>;
  onConnectAttempt: (sourceId: string, targetId: string) => void;
  isValidConnection: (sourceId: string, targetId: string) => boolean;
  onNodeHover: (id: string | null) => void;
  onNodeClick?: (id: string) => void;
  onEdgeClick: (id: string) => void;
  onPaneClick: () => void;
  onPaneContextMenu: (x: number, y: number) => void;
  /** authoringSuspended passthrough — hard-hides hover/connect/context-menu (design §1C step 2). */
  disabled: boolean;
  daemonConnected: boolean;
}

/**
 * GraphCanvas — root shell (PLAN §9.1 row 1). Replaces `<ReactFlow>` +
 * `<ReactFlowProvider>` + `<Background>`. Owns the absolute node layer + the
 * `<svg>` edge layer, `DotGridBackground`, pane click/context-menu dispatch,
 * imperative `fitView()`, and hosts `useConnectDrag`.
 *
 * E10 (PLAN §9.2): renders DIRECTLY from `nodes`/`edges` props every render —
 * NEVER holds a second copy in local state. The only local state here is
 * `dragConnect` (owned by `useConnectDrag`), which is ephemeral UI, not
 * derived data.
 *
 * No pan/zoom (PLAN §9.3 Q1, resolved architectural recommendation — NOT yet
 * confirmed by the product owner per STATE §9.4, flagged for `/build`
 * kickoff / Checker sign-off): plain scrollable container sized to the
 * bounding box of all node positions; `fitView()` scrolls the container to
 * the origin/top-left of the content rather than animating a transform.
 */
export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  {
    nodes,
    edges,
    nodeTypes,
    onConnectAttempt,
    isValidConnection,
    onNodeHover,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onPaneContextMenu,
    disabled,
    daemonConnected,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Node-rect registry (PLAN §9.1.2) — derived once per render from the SAME
  // `nodes` array already received as props, never DOM-measured.
  const nodeRects = useMemo(() => {
    const map = new Map<string, ReturnType<typeof nodeRect>>();
    for (const n of nodes) map.set(n.id, nodeRect(n));
    return map;
  }, [nodes]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // HTML label-layer mount target (REVIEW round-1 blocker fix, STATE
  // §12/§13): each `GraphEdge` below portals its badge/toolbar/delete-
  // confirm `<div>` (`GraphEdgeLabel`) into this node, which is a plain
  // sibling of the `<svg>` edge layer, NOT nested under it — so the portaled
  // content is created in the HTML namespace and receives normal
  // `position`/Tailwind/box-model layout. `labelLayerEl` is tracked in state
  // (not a bare ref) so the first render — before the DOM node exists —
  // correctly skips the portal instead of portaling into `null`.
  const [labelLayerEl, setLabelLayerEl] = useState<HTMLDivElement | null>(null);

  const { dragConnect, startDrag } = useConnectDrag({
    nodeRects,
    isValidConnection,
    onConnectAttempt,
    disabled,
    daemonConnected,
    containerRef,
  });

  // STATE §19 (connect-drag SVG clipping fix): fold the live drag cursor into
  // the bounding box so the SVG edge layer's width/height, the container's
  // minHeight, and fitView()'s scroll target all expand to keep the ghost
  // connect-drag line in view, not clipped at the pre-drag node bounds.
  const content = useMemo(
    () => boundingBox(nodes, dragConnect ? [dragConnect.cursor] : []),
    [nodes, dragConnect]
  );

  useImperativeHandle(
    ref,
    () => ({
      fitView() {
        const el = containerRef.current;
        if (!el) return;
        // Scroll-to-fit replacement for xyflow's transform-based fitView
        // (PLAN §9.3 Q1) — scroll the bounding box's top-left into view with
        // the same felt easing target (smooth scroll, no explicit duration
        // knob available on scrollTo, functionally equivalent UX).
        el.scrollTo({ left: Math.max(0, content.minX - 20), top: Math.max(0, content.minY - 20), behavior: "smooth" });
      },
    }),
    [content]
  );

  const handlePaneClick = useCallback(() => {
    onPaneClick();
  }, [onPaneClick]);

  const handlePaneContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (disabled) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      onPaneContextMenu(e.clientX - rect.left, e.clientY - rect.top);
    },
    [disabled, onPaneContextMenu]
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-auto"
      onClick={handlePaneClick}
      onContextMenu={handlePaneContextMenu}
      style={{ minHeight: Math.max(content.height + 80, 480) }}
    >
      <DotGridBackground />

      {/* Edge layer — pointer-events: none on the SVG root, auto on
          individual paths (PLAN design §5 note 2 — xyflow handled this
          internally; must be explicitly replicated so edges don't block
          node clicks underneath them). SVG-VALID CONTENT ONLY (REVIEW
          round-1 blocker fix, STATE §12/§13): each `GraphEdge` below renders
          only `<path>` elements here (`GraphEdgePath`) and portals its
          badge/toolbar/delete-confirm HTML (`GraphEdgeLabel`) into the
          `labelLayerEl` HTML layer instead of nesting it under `<svg>`. */}
      <svg
        className="absolute left-0 top-0"
        style={{
          width: Math.max(content.maxX + 40, 1),
          height: Math.max(content.maxY + 40, 1),
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        <g style={{ pointerEvents: "auto" }}>
          {edges.map((e) => {
            const sourceNode = nodeById.get(e.source);
            const targetNode = nodeById.get(e.target);
            if (!sourceNode || !targetNode) return null;
            return (
              <GraphEdge
                key={e.id}
                id={e.id}
                edge={e}
                sourcePoint={sourceAnchor(sourceNode)}
                targetPoint={targetAnchor(targetNode)}
                disabled={disabled}
                onEdgeClick={onEdgeClick}
                labelLayerEl={labelLayerEl}
              />
            );
          })}

          {/* Ghost connect-drag edge — cursor-following, dashed. */}
          {dragConnect &&
            (() => {
              const sourceNode = nodeById.get(dragConnect.sourceId);
              if (!sourceNode) return null;
              const source = sourceAnchor(sourceNode);
              return (
                <path
                  d={`M${source.x},${source.y} L${dragConnect.cursor.x},${dragConnect.cursor.y}`}
                  fill="none"
                  stroke="#c7d2fe"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  style={{ pointerEvents: "none" }}
                />
              );
            })()}
        </g>
      </svg>

      {/* Node layer — absolute-positioned divs, above the edge layer. Also
          the portal TARGET for each edge's badge/toolbar/delete-confirm
          `<div>` (REVIEW round-1 blocker fix, STATE §12/§13) — a genuine
          HTML layer, a plain sibling of the `<svg>` edge layer above, not
          nested under it, so portaled content is created in the HTML
          namespace and receives normal `position`/Tailwind/box-model layout. */}
      <div ref={setLabelLayerEl} className="relative" style={{ zIndex: 2 }}>
        {nodes.map((n) => {
          const Component = nodeTypes[n.type];
          if (!Component) return null;
          return (
            <GraphNode
              key={n.id}
              id={n.id}
              position={n.position}
              width={n.width}
              onMouseEnter={disabled ? undefined : () => onNodeHover(n.id)}
              onMouseLeave={disabled ? undefined : () => onNodeHover(null)}
              onClick={onNodeClick ? () => onNodeClick(n.id) : undefined}
            >
              <NodeConnectBoundary
                onStartDrag={(clientX, clientY) => startDrag(n.id, clientX, clientY)}
              >
                <Component data={n.data} />
              </NodeConnectBoundary>
            </GraphNode>
          );
        })}
      </div>
    </div>
  );
});

/**
 * GraphEdge — one edge's full rendering, split across two DOM subtrees
 * (REVIEW round-1 blocker fix, STATE §12/§13): the SVG-valid `<path>`
 * elements (`GraphEdgePath`) render here directly as a `<g>` child, valid
 * inside `<svg>`; the badge/toolbar/delete-confirm HTML (`GraphEdgeLabel`)
 * is portaled into `labelLayerEl` — the plain HTML node layer that is a
 * sibling of the `<svg>` edge layer, NOT nested under it — via
 * `createPortal`. Both halves are driven by ONE `useEdgeInteraction`
 * instance so hover/delete-confirm/draw-in state stays in sync between them
 * without needing to lift state up through `GraphCanvas`.
 *
 * `createPortal` here targets a DOM node that already exists as a sibling
 * in this SAME component tree (not `document.body` and not a re-implemented
 * `EdgeLabelRenderer`-style external root) — this is the standard React
 * mechanism for "render this subtree's output into a different DOM parent
 * than its logical React parent," used here because `GraphEdge`'s SVG half
 * and HTML half must be genuine siblings in the DOM for the SVG namespace
 * issue to be fixed, while still sharing one interaction-state instance.
 */
function GraphEdge({
  id,
  edge,
  sourcePoint,
  targetPoint,
  disabled,
  onEdgeClick,
  labelLayerEl,
}: {
  id: string;
  edge: GraphCanvasEdge;
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
  disabled: boolean;
  onEdgeClick: (id: string) => void;
  labelLayerEl: HTMLDivElement | null;
}) {
  const interaction = useEdgeInteraction(id, edge.data?.drawIndex ?? 0);

  return (
    <>
      <g
        onClick={
          disabled
            ? undefined
            : (ev) => {
                ev.stopPropagation();
                onEdgeClick(id);
              }
        }
      >
        <GraphEdgePath
          id={id}
          sourcePoint={sourcePoint}
          targetPoint={targetPoint}
          data={edge.data}
          interaction={interaction}
        />
      </g>
      {labelLayerEl &&
        createPortal(
          <GraphEdgeLabel
            sourcePoint={sourcePoint}
            targetPoint={targetPoint}
            data={edge.data}
            interaction={interaction}
          />,
          labelLayerEl
        )}
    </>
  );
}

/**
 * NodeConnectBoundary — intercepts mousedown on a source `NodeHandle` inside
 * the rendered leaf component and forwards the CURRENT client coordinates to
 * `useConnectDrag.startDrag` (the leaf `NodeHandle` itself only calls
 * `onDragStart()` with no args, per its existing `Handle`-derived contract —
 * this boundary supplies the missing client-coordinate context via a native
 * `onMouseDownCapture`, avoiding a prop-drilled coordinate argument through
 * `CommandNode`/`AgentNode`, which the migration plan requires stay
 * otherwise untouched beyond the `Handle` -> `NodeHandle` import swap).
 */
function NodeConnectBoundary({
  onStartDrag,
  children,
}: {
  onStartDrag: (clientX: number, clientY: number) => void;
  children: ReactNode;
}) {
  return (
    <div
      onMouseDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-handle-role="source"]')) {
          onStartDrag(e.clientX, e.clientY);
        }
      }}
    >
      {children}
    </div>
  );
}
