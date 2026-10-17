"use client";

import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query. `defaultValue` is returned on the first
 * render (server / pre-hydration) so static HTML matches, then the real value
 * is applied after mount. Pure UI helper — no layout-dependent logic.
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState(defaultValue);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}
