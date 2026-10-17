import { Suspense } from "react";
import { SettingsShell } from "@/components/SettingsShell";

export default function SettingsPage() {
  // SettingsShell reads `?project=<id>` via useSearchParams (P3, F7's
  // project-scoping) — Next.js App Router requires a Suspense boundary
  // around any component using useSearchParams in a static/prerendered page.
  return (
    <Suspense fallback={null}>
      <SettingsShell />
    </Suspense>
  );
}
