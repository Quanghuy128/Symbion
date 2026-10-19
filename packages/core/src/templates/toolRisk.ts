import { parseFrontmatter } from "../render/frontmatter.js";
import type { TemplateKind } from "./parseTemplate.js";

/**
 * toolRisk.ts — "what will Apply actually give this template?" risk
 * assessment for UNVERIFIED sources (docs/loops/templates-repo-url-STATE.md
 * PLAN §8.6, flaw F4). Pure.
 *
 * Only AGENTS get an applied `tools` list; "no tools field" means ALL tools
 * for an agent only. Commands/skills use `allowed-tools`, which Symbion's
 * applyTemplate never carries across (custom frontmatter is dropped), so it
 * is reported as "declared, not applied".
 */

export interface AssessedTool {
  name: string;
  /** the name before "(" — `Bash(git:*)` -> `Bash`. */
  base: string;
  level: "high" | "normal";
  reason?: string;
}

export interface TemplateToolAssessment {
  appliedTools: AssessedTool[];
  allToolsImplicit: boolean;
  declaredAllowedTools: string[];
  inlineShell: boolean;
  hasHighRisk: boolean;
}

const HIGH_RISK_REASONS: Record<string, string> = {
  bash: "runs shell commands",
  write: "creates/overwrites files",
  edit: "creates/overwrites files",
  multiedit: "creates/overwrites files",
  notebookedit: "creates/overwrites files",
  webfetch: "network access",
  websearch: "network access",
  "*": "all tools",
};

export const HIGH_RISK_TOOLS: readonly string[] = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "mcp__*",
  "*",
];

function classify(name: string): AssessedTool {
  const trimmed = name.trim();
  const paren = trimmed.indexOf("(");
  const base = (paren === -1 ? trimmed : trimmed.slice(0, paren)).trim();
  const key = base.toLowerCase();
  if (key.startsWith("mcp__")) return { name: trimmed, base, level: "high", reason: "external MCP server tool" };
  const reason = HIGH_RISK_REASONS[key];
  if (reason) return { name: trimmed, base, level: "high", reason };
  return { name: trimmed, base, level: "normal" };
}

/** CSV split that does not split inside parentheses (`Bash(git add:*, x)`). */
function splitCsv(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const INLINE_SHELL_RE = /!`[^`\n]+`/;

export function assessTemplateTools(input: {
  kind: TemplateKind;
  tools?: string[];
  raw: string;
}): TemplateToolAssessment {
  const { kind, tools, raw } = input;

  let declaredAllowedTools: string[] = [];
  let body = raw;
  const m = FRONTMATTER_RE.exec(raw.replace(/\r\n/g, "\n"));
  if (m) {
    body = m[2] ?? "";
    if (kind !== "agent") {
      try {
        const fm = parseFrontmatter(m[1] ?? "");
        const field = fm.customFields.find((c) => c.key === "allowed-tools");
        if (field) declaredAllowedTools = splitCsv(field.value);
      } catch {
        declaredAllowedTools = [];
      }
    }
  }

  let appliedTools: AssessedTool[] = [];
  let allToolsImplicit = false;
  if (kind === "agent") {
    if (!tools || tools.length === 0) allToolsImplicit = true;
    else appliedTools = tools.map(classify);
  }

  const inlineShell = kind !== "agent" && INLINE_SHELL_RE.test(body);
  const hasHighRisk = appliedTools.some((t) => t.level === "high") || allToolsImplicit || inlineShell;

  return { appliedTools, allToolsImplicit, declaredAllowedTools, inlineShell, hasHighRisk };
}
