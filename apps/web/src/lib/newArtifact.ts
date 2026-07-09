import type { CanonicalArtifact } from "@symbion/core";

/**
 * newArtifact — shared factory for a blank draft artifact (interactive-graph P4).
 * Hoisted out of ProjectView so BOTH the list and the graph create identical
 * drafts (no drift). Optionally pre-names the draft (used by the graph's
 * missing-agent "Tạo agent này" action, P7, to seed the mention name).
 *
 * A4/E8: this only builds an in-memory draft; it is NEVER placed on the canvas
 * or persisted until the BuilderDrawer's own Save resolves.
 */
export function newArtifact(kind: "agent" | "command", name = ""): CanonicalArtifact {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind,
    name,
    description: "",
    body: "",
    meta: { version: "draft", status: "draft", createdAt: now, updatedAt: now },
  };
}
