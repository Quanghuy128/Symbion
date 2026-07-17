import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static structural guard for REVIEW round-1's blocker (STATE §12/§13),
 * mirroring `e10Invariant.test.ts`'s source-text-check pattern: assert no
 * non-SVG-valid JSX element is emitted as a descendant of `<svg>`/`<g>` in
 * `GraphCanvas.tsx`'s edge layer, and that `GraphEdgePath.tsx` — the
 * component rendered directly inside that `<svg><g>` — contains no `<div>`
 * (or other HTML-only tag) in its returned JSX.
 *
 * This does not replace `svgLabelNamespace.test.tsx`'s runtime namespaceURI
 * assertion — it guards the SAME invariant from the source-text angle, so a
 * future edit that re-introduces an HTML element inside the SVG subtree is
 * caught even before a browser/jsdom render would reveal it.
 */
describe("SVG edge layer contains no non-SVG-valid elements (source-level check)", () => {
  const dir = join(__dirname);

  function read(file: string): string {
    return readFileSync(join(dir, file), "utf8");
  }

  const SVG_VALID_TAGS = new Set([
    "svg",
    "g",
    "path",
    "circle",
    "rect",
    "pattern",
    "defs",
    "marker",
    "line",
    "polyline",
    "polygon",
    "ellipse",
    "text",
    "tspan",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "use",
  ]);

  it("GraphEdgePath.tsx — the component rendered inside <svg><g> — returns only SVG-valid elements, no <div>/<span>/etc.", () => {
    const src = read("GraphEdgePath.tsx");
    // Extract the JSX returned by the component (from `return (` to the
    // matching close) and scan for opening tags.
    const returnMatch = src.match(/return \(([\s\S]*)\);\n}/);
    expect(returnMatch).not.toBeNull();
    const jsx = returnMatch?.[1] ?? "";
    expect(jsx.length).toBeGreaterThan(0);

    const tagMatches = [...jsx.matchAll(/<([a-zA-Z][a-zA-Z0-9.]*)[\s/>]/g)];
    expect(tagMatches.length).toBeGreaterThan(0);
    for (const match of tagMatches) {
      const tag = match[1] ?? "";
      expect(
        SVG_VALID_TAGS.has(tag),
        `GraphEdgePath.tsx must only render SVG-valid tags inside <svg><g> — found <${tag}>`
      ).toBe(true);
    }

    // Explicitly guard against the exact regression: no <div> anywhere in
    // this file's JSX (the badge/toolbar HTML now lives in GraphEdgeLabel.tsx).
    expect(jsx).not.toMatch(/<div\b/);
  });

  it("GraphCanvas.tsx's <svg>...</svg> block contains no <div> (or other non-SVG-valid) JSX child", () => {
    const rawSrc = read("GraphCanvas.tsx");
    // Strip `/* ... */` and `// ...` comments first — the file's own doc
    // comments reference `<svg>`/`<div>` in prose, which would otherwise
    // produce false positives/negatives in the tag scan below.
    const src = rawSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const svgBlockMatch = src.match(/<svg[\s>][\s\S]*?<\/svg>/);
    expect(svgBlockMatch).not.toBeNull();
    const svgBlock = svgBlockMatch![0];

    // No raw <div>, <span>, <button>, etc. as a literal JSX tag inside the
    // <svg> block. (Component references like <GraphEdge .../> are fine —
    // GraphEdgePath.tsx's own test above guards THEIR internal output;
    // GraphEdge portals its HTML half out via createPortal, which by
    // construction cannot appear as literal JSX inside this block.)
    expect(svgBlock).not.toMatch(/<div\b/);
    expect(svgBlock).not.toMatch(/<span\b/);
    expect(svgBlock).not.toMatch(/<button\b/);
  });

  it("GraphCanvas.tsx uses createPortal (not raw JSX nesting) to place edge-label HTML outside the <svg> subtree", () => {
    const src = read("GraphCanvas.tsx");
    expect(src).toMatch(/createPortal\(/);
    expect(src).toMatch(/from "react-dom"/);
  });
});
