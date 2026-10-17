"use client";

/**
 * DotGridBackground — the graph canvas dot pattern. Pitch 16px (the 4px-grid
 * `space-4`), 1.2px dot radius, colour from the `graph-dot` token via the
 * `fill-graph-dot` class (a CSS variable in a presentation attribute is
 * unreliable, so the fill is applied through a class). The graph has no
 * pan/zoom, so the pattern is unscaled, and no snapping depends on the pitch.
 */
export function DotGridBackground() {
  const gap = 16;
  const radius = 1.2;

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
          <circle cx={radius} cy={radius} r={radius} className="fill-graph-dot" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="url(#graph-dot-grid)" />
    </svg>
  );
}
