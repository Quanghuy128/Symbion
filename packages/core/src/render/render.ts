import type { CanonicalArtifact, TargetId } from "../ir/types.js";
import type { RenderedFile } from "../adapters/types.js";
import { getAdapter } from "../adapters/registry.js";

export interface RenderArtifactsOptions {
  version: string;
  existingForeignContent?: string;
}

/**
 * renderArtifacts — IR -> RenderedFile[] for a single target. Thin wrapper over
 * the target's adapter; pure, no disk access.
 */
export function renderArtifacts(
  artifacts: CanonicalArtifact[],
  target: TargetId,
  opts: RenderArtifactsOptions
): RenderedFile[] {
  const adapter = getAdapter(target);
  return adapter.render(artifacts, opts);
}
