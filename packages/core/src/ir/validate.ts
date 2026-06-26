import type { CanonicalArtifact, LintIssue } from "./types.js";
import { extractAgentMentions } from "./refs.js";

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
