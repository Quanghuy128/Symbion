import { describe, expect, it } from "vitest";
import { boundingBox, nodeRect, pointInRect, sourceAnchor, targetAnchor, type GeometryNode } from "./graphGeometry";

function node(id: string, x: number, y: number, width = 160, height = 40): GeometryNode {
  return { id, position: { x, y }, width, height };
}

describe("graphGeometry", () => {
  it("T-2.1: source-anchor point for a command node at {x:0,y:0}, NODE_WIDTH=160/NODE_HEIGHT=40 -> right-mid {160,20}", () => {
    const n = node("cmd-1", 0, 0, 160, 40);
    expect(sourceAnchor(n)).toEqual({ x: 160, y: 20 });
  });

  it("T-2.2: target-anchor point for an agent node -> left-mid {x, y+height/2}", () => {
    const n = node("agent-1", 300, 80, 160, 40);
    expect(targetAnchor(n)).toEqual({ x: 300, y: 100 });
  });

  it("T-2.3: fitView bounding box over 3 nodes at varying positions/widths -> correct min/max envelope", () => {
    const nodes = [node("a", 0, 0, 160, 40), node("b", 200, -50, 160, 40), node("c", 400, 100, 200, 40)];
    const box = boundingBox(nodes);
    expect(box.minX).toBe(0);
    expect(box.minY).toBe(-50);
    expect(box.maxX).toBe(600); // 400 + 200
    expect(box.maxY).toBe(140); // 100 + 40
  });

  it("T-2.4: fitView bounding box over 0 nodes (empty graph) -> sane default, no NaN/Infinity", () => {
    const box = boundingBox([]);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
    expect(Number.isFinite(box.minX)).toBe(true);
    expect(Number.isFinite(box.maxX)).toBe(true);
  });

  it("T-2.5: missing-agent node uses MISSING_AGENT_NODE_WIDTH not NODE_WIDTH for its anchor calc", () => {
    const missing = node("missing-foo", 100, 0, 200, 40); // MISSING_AGENT_NODE_WIDTH=200
    const regular = node("agent-1", 100, 0, 160, 40); // NODE_WIDTH=160
    expect(sourceAnchor(missing).x).toBe(300);
    expect(sourceAnchor(regular).x).toBe(260);
    expect(sourceAnchor(missing).x).not.toBe(sourceAnchor(regular).x);
  });

  it("nodeRect returns the full rect for the connect-drag hit-testing registry", () => {
    const n = node("cmd-1", 10, 20, 160, 40);
    expect(nodeRect(n)).toEqual({ x: 10, y: 20, width: 160, height: 40 });
  });

  it("pointInRect: point inside/outside/on-boundary", () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(pointInRect({ x: 50, y: 25 }, rect)).toBe(true);
    expect(pointInRect({ x: 0, y: 0 }, rect)).toBe(true); // boundary inclusive
    expect(pointInRect({ x: 100, y: 50 }, rect)).toBe(true); // boundary inclusive
    expect(pointInRect({ x: 101, y: 25 }, rect)).toBe(false);
    expect(pointInRect({ x: 50, y: -1 }, rect)).toBe(false);
  });
});
