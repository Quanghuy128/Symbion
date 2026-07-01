import type { TemplateKind } from "./parseTemplate.js";

/**
 * TemplateListItem — the shared shape both the bundled (Symbion) gallery and
 * the live-fetched (GitHub-backed) author paths produce, consumed identically
 * by TemplateCard/TemplateSection/TemplatePreviewModal regardless of source
 * (templates-authors-STATE.md PLAN §P2, FR4: "the modal doesn't need to know
 * or care where that string came from").
 *
 * Moved here (was previously hand-declared in
 * apps/web/src/data/templates/manifest.ts) so apps/daemon's
 * fetchAuthorTemplates handler and apps/web's bundled-manifest loader share
 * the exact same type, not a hand-duplicated shape — PLAN §P9.
 */
export interface TemplateListItem {
  /**
   * stable slug, used as sourceTemplateId on Apply. Format differs by author
   * (PLAN §P5): Symbion-bundled items keep their pre-existing
   * "agent:code-reviewer" shape (unchanged, not retrofixed); GitHub-backed
   * items use "{authorId}:{repoRelativePath}", e.g.
   * "ecc:agents/code-reviewer.md". Opaque to the daemon either way — never
   * parsed/interpreted server-side, only stored verbatim.
   */
  id: string;
  kind: TemplateKind;
  /** becomes CanonicalArtifact.name on Apply. */
  name: string;
  /** one-line, shown on card + becomes CanonicalArtifact.description. */
  description: string;
  tools?: string[];
  /** exact bytes of the .md-equivalent source — what "Copy markdown" copies verbatim. */
  raw: string;
  /** "symbion" | "ecc" | future AUTHOR_REGISTRY ids. */
  authorId: string;
  /** denormalized for the UI, avoids a registry lookup in every card. */
  authorDisplayName: string;
  /** present iff this item's author source kind === "github", e.g. "affaan-m/ecc". */
  authorRepoLabel?: string;
}
