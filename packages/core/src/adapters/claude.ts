import type { CanonicalArtifact } from "../ir/types.js";
import type { RenderOptions, RenderedFile, TargetAdapter, TargetCapability } from "./types.js";
import { artifactToFrontmatterFields, serializeFrontmatter } from "../render/frontmatter.js";
import { buildMarker, computeContentHash, parseMarker } from "../render/marker.js";

const capability: TargetCapability = {
  id: "claude",
  label: "Claude",
  supportsCommands: true,
  supportsPerAgentFile: true,
  fileFormat: "md-per-file",
  lossy: false,
};

function relPathFor(artifact: CanonicalArtifact): string {
  return artifact.kind === "agent"
    ? `.claude/agents/${artifact.name}.md`
    : `.claude/commands/${artifact.name}.md`;
}

/** Render the frontmatter+body for one artifact, WITHOUT the trailing marker. */
function renderBodyWithFrontmatter(artifact: CanonicalArtifact): string {
  const fields = artifactToFrontmatterFields(artifact);
  const fm = serializeFrontmatter(fields);
  return `---\n${fm}\n---\n${artifact.body}`;
}

function renderOne(artifact: CanonicalArtifact, version: string): RenderedFile {
  const base = renderBodyWithFrontmatter(artifact);
  // Hash is computed over the canonical content WITHOUT any marker present.
  const fullHash = computeContentHash(base);
  const marker = buildMarker(artifact.id, artifact.kind, version, fullHash);
  const content = `${base}\n${marker}\n`;

  return {
    relPath: relPathFor(artifact),
    content,
    artifactIds: [artifact.id],
    contentHash: fullHash,
  };
}

function render(artifacts: CanonicalArtifact[], opts: RenderOptions): RenderedFile[] {
  return artifacts.map((artifact) => renderOne(artifact, opts.version));
}

export const claudeAdapter: TargetAdapter = {
  capability,
  render,
  parseMarker,
};
