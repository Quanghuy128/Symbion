import type { CanonicalArtifact, TargetId } from "../ir/types.js";
import type { ManagedMarker, RegionMarker } from "../render/marker.js";

export interface TargetCapability {
  id: TargetId;
  label: string; // "Claude" | "Codex"
  supportsCommands: boolean; // Claude true, Codex false (lossy -> flatten)
  supportsPerAgentFile: boolean; // Claude true, Codex false (single AGENTS.md)
  fileFormat: "md-per-file" | "md-merged";
  lossy: boolean; // Codex true -> UI shows badge + "Tôi hiểu"
}

export interface RenderedFile {
  relPath: string; // ".claude/agents/ba.md" | "AGENTS.md"
  content: string; // full byte content INCLUDING managed marker
  artifactIds: string[]; // which IR artifacts contributed (>=1; merged targets -> many)
  contentHash: string; // full sha256 of canonical content (excluding the hash field itself)
}

export interface RenderOptions {
  version: string;
  /**
   * For merged/lossy targets (Codex): pre-existing on-disk content outside the
   * managed fence, to be preserved verbatim around the regenerated region.
   * Pure render only NEEDS this to reproduce the splice; daemon supplies it
   * from a prior read. Undefined => no existing foreign content to preserve.
   */
  existingForeignContent?: string;
}

export interface TargetAdapter {
  capability: TargetCapability;
  /** PURE: IR -> files. Merged adapters fold many artifacts into one RenderedFile. */
  render(artifacts: CanonicalArtifact[], opts: RenderOptions): RenderedFile[];
  /** PURE: given an on-disk file's content, extract the managed marker (id/version/hash), or null if foreign. */
  parseMarker(content: string): ManagedMarker | RegionMarker | null;
}
