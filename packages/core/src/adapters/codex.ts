import type { CanonicalArtifact } from "../ir/types.js";
import type { RenderOptions, RenderedFile, TargetAdapter, TargetCapability } from "./types.js";
import {
  buildRegionEnd,
  buildRegionStart,
  computeContentHash,
  parseRegionMarker,
} from "../render/marker.js";

const capability: TargetCapability = {
  id: "codex",
  label: "Codex",
  supportsCommands: false,
  supportsPerAgentFile: false,
  fileFormat: "md-merged",
  lossy: true,
};

function renderAgentSection(artifact: CanonicalArtifact): string {
  const toolsLine =
    artifact.tools && artifact.tools.length > 0
      ? `\n> tools: ${artifact.tools.join(", ")}  (note: Codex ignores per-agent tools)`
      : "";
  return `## Agent: ${artifact.name}${toolsLine}\n${artifact.body}\n`;
}

function renderCommandSection(artifact: CanonicalArtifact): string {
  return `## Command: /${artifact.name}\n> Slash command (flattened — Codex has no command primitive)\n${artifact.body}\n`;
}

/** Build the managed region body (sections only, no fence) — deterministic ordering. */
function buildRegionBody(artifacts: CanonicalArtifact[]): string {
  const agents = artifacts
    .filter((a) => a.kind === "agent")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const commands = artifacts
    .filter((a) => a.kind === "command")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const sections: string[] = ["# Symbion-managed workflows\n"];
  for (const agent of agents) sections.push(renderAgentSection(agent));
  for (const command of commands) sections.push(renderCommandSection(command));

  return sections.join("\n");
}

function render(artifacts: CanonicalArtifact[], opts: RenderOptions): RenderedFile[] {
  const regionBody = buildRegionBody(artifacts);
  const fullHash = computeContentHash(regionBody);
  const start = buildRegionStart(opts.version, fullHash);
  const end = buildRegionEnd();
  const managedRegion = `${start}\n${regionBody}\n${end}`;

  const foreign = opts.existingForeignContent?.trim();
  const content = foreign && foreign.length > 0 ? `${foreign}\n\n${managedRegion}\n` : `${managedRegion}\n`;

  return [
    {
      relPath: "AGENTS.md",
      content,
      artifactIds: artifacts.map((a) => a.id),
      contentHash: fullHash,
    },
  ];
}

export const codexAdapter: TargetAdapter = {
  capability,
  render,
  parseMarker: parseRegionMarker,
};
