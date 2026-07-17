import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphCanvas, type GraphCanvasEdge, type GraphCanvasNode } from "./GraphCanvas";

/**
 * Regression test for REVIEW round-1's blocker (STATE §12/§13): the edge
 * badge/toolbar/delete-confirm `<div>` must be created in the HTML
 * namespace, not the SVG namespace. Mirrors the Checker's own reproduction
 * (`code-reviewer`'s throwaway RTL test asserting `namespaceURI`).
 *
 * Before the fix, `GraphEdgePath` returned the badge `<div>` as a JSX
 * sibling of its `<path>` elements, and `GraphCanvas` rendered
 * `<GraphEdgePath>` as a child of `<svg><g>` — per the SVG/HTML content
 * model, a plain `<div>` nested under an `<svg>` ancestor is created in the
 * SVG XML namespace (`http://www.w3.org/2000/svg`), not
 * `http://www.w3.org/1999/xhtml`, so it never received `position: absolute`,
 * Tailwind classes, or normal box-model layout in a real browser.
 */
function TestNode({ data }: { data: { label: string } }) {
  return <div data-testid={`node-${data.label}`}>{data.label}</div>;
}

const nodeTypes = { command: TestNode, agent: TestNode, missingAgent: TestNode };

function nodes(): GraphCanvasNode[] {
  return [
    { id: "cmd-1", type: "command", position: { x: 0, y: 0 }, width: 160, height: 40, data: { label: "cmd-1" } },
    { id: "agent-1", type: "agent", position: { x: 300, y: 0 }, width: 160, height: 40, data: { label: "agent-1" } },
  ];
}

function edges(): GraphCanvasEdge[] {
  return [
    {
      id: "cmd-1->agent-1",
      source: "cmd-1",
      target: "agent-1",
      // count > 1 forces the badge to actually render (not just the hover
      // surface) so there's real content to assert a namespace on.
      data: { interactive: true, count: 3 },
    },
  ];
}

describe("edge badge/toolbar HTML namespace (REVIEW round-1 blocker regression)", () => {
  it("the ×N badge <span>/<div> is created in the HTML namespace, not the SVG namespace", () => {
    render(
      <GraphCanvas
        nodes={nodes()}
        edges={edges()}
        nodeTypes={nodeTypes}
        onConnectAttempt={() => {}}
        isValidConnection={() => true}
        onNodeHover={() => {}}
        onEdgeClick={() => {}}
        onPaneClick={() => {}}
        onPaneContextMenu={() => {}}
        disabled={false}
        daemonConnected
      />
    );

    const badge = screen.getByText("×3");
    expect(badge.namespaceURI).toBe("http://www.w3.org/1999/xhtml");

    // The badge's whole ancestor chain up to (but not including) the SVG
    // root must also be HTML-namespaced — a single mis-nested ancestor
    // would silently re-create this class of bug even if the badge text
    // node itself happened to test HTML.
    let el: Element | null = badge;
    while (el && el.tagName.toLowerCase() !== "svg") {
      expect(el.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
      el = el.parentElement;
    }
  });

  it("the <svg> edge layer itself remains in the SVG namespace (sanity check)", () => {
    const { container } = render(
      <GraphCanvas
        nodes={nodes()}
        edges={edges()}
        nodeTypes={nodeTypes}
        onConnectAttempt={() => {}}
        isValidConnection={() => true}
        onNodeHover={() => {}}
        onEdgeClick={() => {}}
        onPaneClick={() => {}}
        onPaneContextMenu={() => {}}
        disabled={false}
        daemonConnected
      />
    );
    const svg = container.querySelector("svg");
    expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });
});
