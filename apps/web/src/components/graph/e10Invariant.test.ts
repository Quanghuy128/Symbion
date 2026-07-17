import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T-7.1 (testplan §1.7 #2) — static grep check: `GraphCanvas`/`GraphNode`/
 * `GraphEdgePath` must contain NO `useState`/`useReducer` holding a copy of
 * `nodes`/`edges`-shaped data — only ephemeral UI state (`dragConnect`,
 * hover/menu-open booleans, drawn/hovered/confirmingDelete flags). This is a
 * source-text check (not a runtime behavior test — that's covered by
 * `GraphCanvas.test.tsx`'s "E10" case) so a future edit can't silently
 * reintroduce a mirrored nodes/edges array without this test catching it.
 */
describe("E10 invariant — self-coded graph components never mirror nodes/edges", () => {
  const dir = join(__dirname);

  function read(file: string): string {
    return readFileSync(join(dir, file), "utf8");
  }

  it("GraphCanvas.tsx has no useState/useReducer whose name suggests a nodes/edges mirror", () => {
    const src = read("GraphCanvas.tsx");
    const stateDeclarations = [...src.matchAll(/use(State|Reducer)<?[^(]*\(([^)]*)\)/g)];
    for (const match of stateDeclarations) {
      const snippet = match[0].toLowerCase();
      expect(snippet).not.toMatch(/\bnodes\b/);
      expect(snippet).not.toMatch(/\bedges\b/);
    }
  });

  it("GraphNode.tsx, GraphEdgePath.tsx, and GraphEdgeLabel.tsx declare no useState/useReducer at all holding node/edge arrays", () => {
    for (const file of ["GraphNode.tsx", "GraphEdgePath.tsx", "GraphEdgeLabel.tsx"]) {
      const src = read(file);
      // GraphNode is a pure positioning wrapper (no local state at all);
      // GraphEdgePath's local state (drawn/hovered/confirmingDelete) is
      // ephemeral UI only — assert none of it is named nodes/edges.
      const stateDeclarations = [...src.matchAll(/const \[(\w+),\s*set\w+\] = useState/g)];
      for (const match of stateDeclarations) {
        const varName = (match[1] ?? "").toLowerCase();
        expect(varName).not.toBe("nodes");
        expect(varName).not.toBe("edges");
      }
    }
  });

  it("GraphCanvas.tsx renders directly from nodes/edges props, not a local copy (source-level check)", () => {
    const src = read("GraphCanvas.tsx");
    // The component's render body should map over the destructured `nodes`/
    // `edges` PROPS (not e.g. `this.state.nodes`) — a light heuristic:
    // confirm `nodes.map(` and `edges.map(` both appear, and no
    // `setNodes`/`setEdges` setter exists anywhere in the file.
    expect(src).toMatch(/nodes\.map\(/);
    expect(src).toMatch(/edges\.map\(/);
    expect(src).not.toMatch(/setNodes\(/);
    expect(src).not.toMatch(/setEdges\(/);
  });
});
