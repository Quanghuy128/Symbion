import type { CanonicalArtifact, LintIssue } from "./types.js";
import { extractAgentMentions } from "./refs.js";
import { hasAgentBlock } from "./agentBlock.js";

/** Lines inside the agents block; used to lint block-line grammar (warnings only). */
const AGENTS_BLOCK_RE =
  /<!-- symbion:agents -->\n([\s\S]*?)\n<!-- \/symbion:agents -->/;
/** A canonical, well-formed agent line: `- @name[ ×count][ — goal]` (× = U+00D7, — = U+2014). */
const AGENT_LINE_OK_RE = /^- @([A-Za-z0-9_-]+)(?: ×(\d+))?(?: — [\s\S]*)?$/;
/** Any line that LOOKS like an agent line (starts with `- @`) — used to catch malformed ones. */
const AGENT_LINE_LOOSE_RE = /^- @/;
/** Extract whatever follows `×` up to the next space, for the count-invalid check. */
const COUNT_TOKEN_RE = /\s×(\S+)/;

/** A filename-safe name: lower/upper alnum, dash, underscore — no path separators or spaces. */
const FILENAME_SAFE_RE = /^[A-Za-z0-9_-]+$/;

const KNOWN_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
  "TodoWrite",
]);

export interface ValidateOptions {
  /** all artifacts in the project, used for duplicate-name + missing-mention checks. */
  allArtifacts: CanonicalArtifact[];
}

/**
 * validateArtifact — pure lint pass over a single artifact in the context of its siblings.
 * Errors block Save; warnings are surfaced but allowed (forward-compat, E6/E7).
 */
export function validateArtifact(
  artifact: CanonicalArtifact,
  opts: ValidateOptions
): LintIssue[] {
  const issues: LintIssue[] = [];
  const id = artifact.id;

  if (!artifact.name || artifact.name.trim().length === 0) {
    issues.push({
      level: "error",
      code: "name-required",
      message: "name là bắt buộc.",
      artifactId: id,
      field: "name",
    });
  } else if (!FILENAME_SAFE_RE.test(artifact.name)) {
    issues.push({
      level: "error",
      code: "name-unsafe",
      message: `name "${artifact.name}" chứa ký tự không hợp lệ cho tên file.`,
      artifactId: id,
      field: "name",
    });
  }

  if (!artifact.description || artifact.description.trim().length === 0) {
    issues.push({
      level: "error",
      code: "description-required",
      message: "description là bắt buộc.",
      artifactId: id,
      field: "description",
    });
  }

  // Duplicate name (same kind) across the project.
  if (artifact.name) {
    const dup = opts.allArtifacts.some(
      (other) =>
        other.id !== artifact.id &&
        other.kind === artifact.kind &&
        other.name === artifact.name
    );
    if (dup) {
      issues.push({
        level: "error",
        code: "name-duplicate",
        message: `Đã có ${artifact.kind} khác tên "${artifact.name}".`,
        artifactId: id,
        field: "name",
      });
    }
  }

  if (artifact.kind === "agent") {
    for (const tool of artifact.tools ?? []) {
      if (!KNOWN_TOOLS.has(tool)) {
        issues.push({
          level: "warning",
          code: "tool-unknown",
          message: `Tool "${tool}" không nằm trong danh sách biết trước (vẫn cho phép).`,
          artifactId: id,
          field: "tools",
        });
      }
    }
  }

  if (artifact.kind === "command") {
    const mentionsArguments = artifact.body.includes("$ARGUMENTS");
    if (artifact.usesArguments && !mentionsArguments) {
      issues.push({
        level: "warning",
        code: "arguments-missing",
        message: "usesArguments được đánh dấu nhưng body không chứa $ARGUMENTS.",
        artifactId: id,
        field: "body",
      });
    }

    const mentions = extractAgentMentions(artifact.body);
    const agentNames = new Set(
      opts.allArtifacts.filter((a) => a.kind === "agent").map((a) => a.name)
    );
    for (const mention of mentions) {
      if (!agentNames.has(mention)) {
        issues.push({
          level: "warning",
          code: "mention-missing-agent",
          message: `@${mention} không tồn tại trong dự án (không tồn tại).`,
          artifactId: id,
          field: "body",
        });
      }
    }

    // Managed `## Agents` block linting — warnings only, never blocks Save.
    if (hasAgentBlock(artifact.body)) {
      const blockMatch = AGENTS_BLOCK_RE.exec(artifact.body);
      const inner = blockMatch?.[1] ?? "";
      for (const rawLine of inner.split("\n")) {
        if (!AGENT_LINE_LOOSE_RE.test(rawLine)) continue;
        const okMatch = AGENT_LINE_OK_RE.exec(rawLine);
        if (!okMatch) {
          // count-invalid gets a more specific code when the malformation is a bad ×token.
          const countToken = COUNT_TOKEN_RE.exec(rawLine)?.[1];
          if (countToken !== undefined && !/^\d+$/.test(countToken)) {
            issues.push({
              level: "warning",
              code: "agentref-count-invalid",
              message: `Số lượng "${countToken}" trong block Agents không phải số nguyên ≥ 1.`,
              artifactId: id,
              field: "body",
            });
          } else {
            issues.push({
              level: "warning",
              code: "agentblock-malformed",
              message: `Dòng "${rawLine}" trong block Agents không đúng cú pháp.`,
              artifactId: id,
              field: "body",
            });
          }
          continue;
        }
        // Well-formed by regex, but ×0 is semantically invalid (integer must be ≥ 1).
        if (okMatch[2] !== undefined && Number.parseInt(okMatch[2], 10) < 1) {
          issues.push({
            level: "warning",
            code: "agentref-count-invalid",
            message: `Số lượng "${okMatch[2]}" trong block Agents phải là số nguyên ≥ 1.`,
            artifactId: id,
            field: "body",
          });
        }
      }
    }
  }

  return issues;
}

/** Convenience: validate every artifact in a project, returning a flat issue list. */
export function validateAllArtifacts(artifacts: CanonicalArtifact[]): LintIssue[] {
  const out: LintIssue[] = [];
  for (const artifact of artifacts) {
    out.push(...validateArtifact(artifact, { allArtifacts: artifacts }));
  }
  return out;
}
