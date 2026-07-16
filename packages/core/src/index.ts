// Public barrel — the only surface @symbion/daemon (and web, via type-only imports) should import.

export * from "./ir/types.js";
export * from "./ir/validate.js";
export * from "./ir/refs.js";
export * from "./ir/agentBlock.js";

export * from "./adapters/types.js";
export { claudeAdapter } from "./adapters/claude.js";
export { codexAdapter } from "./adapters/codex.js";
export { ADAPTERS, getAdapter } from "./adapters/registry.js";

export * from "./render/frontmatter.js";
export * from "./render/marker.js";
export * from "./render/render.js";

export * from "./parse/scan.js";
export * from "./parse/pickedFile.js";
export * from "./parse/dedupeImportNames.js";

export * from "./templates/parseTemplate.js";
export * from "./templates/authorSource.js";
export * from "./templates/matchAuthorFolders.js";
export * from "./templates/templateListItem.js";

export * from "./diff/diff.js";
export * from "./diff/conflict.js";

export * from "./version/semver.js";

export * from "./runcommand/render.js";

export * from "./run/events.js";
export * from "./run/parseStreamJson.js";
export * from "./run/pricing.js";
export * from "./run/aggregate.js";
export * from "./run/derive.js";

export * from "./generate/description.js";
export * from "./generate/bodyPrompt.js";

export { sha256Hex } from "./util/sha256.js";
