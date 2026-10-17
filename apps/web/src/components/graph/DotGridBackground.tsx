"use client";

/**
 * DotGridBackground — self-coded replacement for `<Background
 * variant={BackgroundVariant.Dots}>` (self-coded-graph-migration PLAN §9.1
 * row 5).
 *
 * Fidelity method (STATE §10, baseline SKIPPED — verified ANALYTICALLY, not
 * by screenshot diff / computed-style sampling): spacing/radius/color read
 * directly from `@xyflow/react`'s compiled source
 * (`node_modules/@xyflow/react/dist/esm/index.js`'s `BackgroundComponent`/
 * `DotPattern`, and `node_modules/@xyflow/react/dist/style.css`'s
 * `.react-flow__background-pattern.dots` rule + `:root`/`.dark` custom
 * property defaults), not measured from a live render:
 *  - default `gap = 20` (px, unscaled — this migration has NO pan/zoom per
 *    PLAN §9.3 Q1, so `transform[2]` (zoom) is always 1, meaning the
 *    `scaledGap`/`scaledSize` scaling xyflow does for pan/zoom collapses to
 *    the raw prop values here).
 *  - `defaultSize.dots = 1`, and `DotPattern` renders `radius = scaledSize / 2`
 *    → 0.5px dot radius at zoom 1.
 *  - dot fill color: `var(--xy-background-pattern-color-props, ...
 *    --xy-background-pattern-dots-color-default)`. `DependencyGraph.tsx` never
 *    applied a `dark` class to its `<ReactFlow>` root (confirmed by grep —
 *    no `className` prop passed to `<ReactFlow>` at all) and never passed a
 *    `color`/`patternClassName` prop to `<Background>`, so the LIGHT-theme
 *    default (`--xy-background-pattern-dots-color-default: #91919a`,
 *    `style.css` line 24) is what was actually rendering, not the `.dark`
 *    variant's `#555` (line 72) — this is a non-obvious fact only confirmable
 *    by reading the CSS cascade, since the rest of Symbion's UI is otherwise
 *    dark-themed; flagged explicitly for the Checker to re-verify given how
 *    easy it would be to assume `#555` instead.
 */
export function DotGridBackground() {
  const gap = 20;
  const radius = 0.5;
  const dotColor = "#91919a";

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 0 }}
    >
      <defs>
        <pattern
          id="graph-dot-grid"
          x={0}
          y={0}
          width={gap}
          height={gap}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={radius} cy={radius} r={radius} fill={dotColor} />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="url(#graph-dot-grid)" />
    </svg>
  );
}
