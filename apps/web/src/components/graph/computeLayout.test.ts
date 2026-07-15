import { describe, expect, it } from "vitest";
import { computeLayout, type LayoutEdgeInput, type LayoutNodeInput } from "./computeLayout";

function node(id: string, width = 160, height = 40): LayoutNodeInput {
  return { id, width, height };
}

function edge(source: string, target: string): LayoutEdgeInput {
  return { source, target };
}

describe("computeLayout", () => {
  it("T-1.1.1: returns a finite numeric position for every node in a simple graph", () => {
    const positions = computeLayout(
      [node("cmd-1"), node("agent-1")],
      [edge("cmd-1", "agent-1")]
    );
    expect(positions.size).toBe(2);
    for (const id of ["cmd-1", "agent-1"]) {
      const pos = positions.get(id);
      expect(pos).toBeDefined();
      expect(Number.isFinite(pos!.x)).toBe(true);
      expect(Number.isFinite(pos!.y)).toBe(true);
    }
  });

  it("T-1.1.2: a disconnected node (no edges reference it) still receives a valid position", () => {
    const positions = computeLayout(
      [node("cmd-1"), node("agent-1"), node("agent-orphan")],
      [edge("cmd-1", "agent-1")]
    );
    const orphanPos = positions.get("agent-orphan");
    expect(orphanPos).toBeDefined();
    expect(Number.isFinite(orphanPos!.x)).toBe(true);
    expect(Number.isFinite(orphanPos!.y)).toBe(true);
  });

  it("T-1.1.3: a missingAgent synthetic node id included in the node list gets a position", () => {
    const positions = computeLayout(
      [node("cmd-1"), node("missing-someAgent", 200, 40)],
      [edge("cmd-1", "missing-someAgent")]
    );
    const pos = positions.get("missing-someAgent");
    expect(pos).toBeDefined();
    expect(Number.isFinite(pos!.x)).toBe(true);
    expect(Number.isFinite(pos!.y)).toBe(true);
  });

  it("T-1.1.4: empty node/edge lists return an empty map without throwing", () => {
    expect(() => computeLayout([], [])).not.toThrow();
    const positions = computeLayout([], []);
    expect(positions.size).toBe(0);
  });

  it("T-1.1.5: two disjoint command->agent pairs do not land on identical positions", () => {
    const positions = computeLayout(
      [node("cmd-1"), node("agent-1"), node("cmd-2"), node("agent-2")],
      [edge("cmd-1", "agent-1"), edge("cmd-2", "agent-2")]
    );
    const all = [...positions.values()].map((p) => `${p.x},${p.y}`);
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });

  it("T-1.1.6: determinism — same input produces the same output positions", () => {
    const nodes = [node("cmd-1"), node("agent-1"), node("agent-2")];
    const edges = [edge("cmd-1", "agent-1"), edge("cmd-1", "agent-2")];

    const first = computeLayout(
      nodes.map((n) => ({ ...n })),
      edges.map((e) => ({ ...e }))
    );
    const second = computeLayout(
      nodes.map((n) => ({ ...n })),
      edges.map((e) => ({ ...e }))
    );

    for (const id of ["cmd-1", "agent-1", "agent-2"]) {
      expect(second.get(id)).toEqual(first.get(id));
    }
  });

  it("T-1.1.7: a 30-node/40-edge synthetic graph completes well within a generous CI-safe bound", () => {
    const nodes: LayoutNodeInput[] = [];
    const edges: LayoutEdgeInput[] = [];
    for (let i = 0; i < 10; i++) nodes.push(node(`cmd-${i}`));
    for (let i = 0; i < 20; i++) nodes.push(node(`agent-${i}`));
    // 40 edges: each command connects to 4 agents (wrapping), guarantees reuse.
    let edgeCount = 0;
    for (let i = 0; i < 10 && edgeCount < 40; i++) {
      for (let j = 0; j < 4 && edgeCount < 40; j++) {
        edges.push(edge(`cmd-${i}`, `agent-${(i * 4 + j) % 20}`));
        edgeCount += 1;
      }
    }

    const start = performance.now();
    const positions = computeLayout(nodes, edges);
    const elapsed = performance.now() - start;

    expect(positions.size).toBe(nodes.length);
    expect(elapsed).toBeLessThan(200);
  });
});
