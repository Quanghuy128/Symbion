import type { TargetId } from "../ir/types.js";
import type { TargetAdapter } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";

export const ADAPTERS: Record<TargetId, TargetAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

export function getAdapter(id: TargetId): TargetAdapter {
  const adapter = ADAPTERS[id];
  if (!adapter) {
    throw new Error(`Unknown target adapter: ${id}`);
  }
  return adapter;
}
