/**
 * manifest.ts — the static template bundle entry point (templates-marketplace
 * PLAN §1). Each `.ts` module under agents/commands/skills exports a stable
 * `id` slug + the exact raw markdown bytes (frontmatter + body). Plain `.ts`
 * template-literal modules, NOT `.md` files + a raw-loader, per PLAN's
 * decision to avoid a new webpack loader dependency for a small v1 bundle.
 *
 * loadTemplateManifest() runs synchronously, client-side, with ZERO network/
 * daemon involvement — confirmed in templates-marketplace PLAN §0(a): bundling
 * here means "Copy markdown" and the whole browse list work even when the
 * daemon is down. Each template is parsed once via parseTemplateMarkdown
 * (packages/core, pure) at manifest-build time; a malformed one goes into
 * `skipped`, never throws (AC7).
 */
import { parseTemplateMarkdown, type TemplateKind, type TemplateListItem } from "@symbion/core";

import * as agentCodeReviewer from "./agents/code-reviewer";
import * as agentTestCoverageAuditor from "./agents/test-coverage-auditor";
import * as agentDependencyUpgradeScout from "./agents/dependency-upgrade-scout";
import * as agentOnboardingDocWriter from "./agents/onboarding-doc-writer";

import * as commandTestWriter from "./commands/test-writer";
import * as commandReleaseNotes from "./commands/release-notes";
import * as commandChangelogEntry from "./commands/changelog-entry";
import * as commandBugRepro from "./commands/bug-repro";

import * as skillCommitMessage from "./skills/commit-message";
import * as skillPrDescription from "./skills/pr-description";
import * as skillApiErrorMessage from "./skills/api-error-message";
import * as skillMigrationChecklist from "./skills/migration-checklist";

// TemplateListItem now lives in @symbion/core (templates-authors PLAN §P9) so
// apps/daemon's fetchAuthorTemplates handler and this bundled-manifest loader
// share the exact same shape. Re-exported here for backward-compat import
// paths inside apps/web (existing call sites import it from this module).
export type { TemplateListItem };

export interface TemplateManifest {
  items: TemplateListItem[];
  skipped: Array<{ relPath: string; reason: string }>;
}

interface RawModule {
  id: string;
  raw: string;
}

const SOURCES: Array<{ relPath: string; kind: TemplateKind; mod: RawModule }> = [
  { relPath: "agents/code-reviewer.ts", kind: "agent", mod: agentCodeReviewer },
  { relPath: "agents/test-coverage-auditor.ts", kind: "agent", mod: agentTestCoverageAuditor },
  { relPath: "agents/dependency-upgrade-scout.ts", kind: "agent", mod: agentDependencyUpgradeScout },
  { relPath: "agents/onboarding-doc-writer.ts", kind: "agent", mod: agentOnboardingDocWriter },

  { relPath: "commands/test-writer.ts", kind: "command", mod: commandTestWriter },
  { relPath: "commands/release-notes.ts", kind: "command", mod: commandReleaseNotes },
  { relPath: "commands/changelog-entry.ts", kind: "command", mod: commandChangelogEntry },
  { relPath: "commands/bug-repro.ts", kind: "command", mod: commandBugRepro },

  { relPath: "skills/commit-message.ts", kind: "skill", mod: skillCommitMessage },
  { relPath: "skills/pr-description.ts", kind: "skill", mod: skillPrDescription },
  { relPath: "skills/api-error-message.ts", kind: "skill", mod: skillApiErrorMessage },
  { relPath: "skills/migration-checklist.ts", kind: "skill", mod: skillMigrationChecklist },
];

/**
 * loadTemplateManifest — synchronous, pure (besides reading the static
 * module-level constants above), safe to call on every TemplatesView mount.
 * A malformed template is excluded from `items` and surfaced in `skipped`
 * with a human reason — never throws, matching parseClaudeDir's discipline.
 */
export function loadTemplateManifest(): TemplateManifest {
  const items: TemplateListItem[] = [];
  const skipped: Array<{ relPath: string; reason: string }> = [];

  for (const source of SOURCES) {
    const result = parseTemplateMarkdown(source.mod.raw, source.kind);
    if (!result.ok) {
      skipped.push({ relPath: source.relPath, reason: result.reason });
      continue;
    }
    // Command templates never carry `name` in frontmatter (matches the
    // existing IR convention — name is filename-derived for commands, see
    // parse/scan.ts). Fall back to the slug portion of the manifest id
    // (e.g. "command:test-writer" -> "test-writer"), the same way a real
    // command's filename becomes its name on import.
    const name = result.parsed.name ?? source.mod.id.split(":").slice(1).join(":");
    items.push({
      id: source.mod.id,
      kind: result.parsed.kind,
      name,
      description: result.parsed.description,
      tools: result.parsed.tools,
      raw: source.mod.raw,
      // templates-authors PLAN §P2: stamp the "Symbion" author identity onto
      // every bundled item. No authorRepoLabel — kind is "bundled", not "github".
      authorId: "symbion",
      authorDisplayName: "Symbion",
    });
  }

  return { items, skipped };
}
