/**
 * preflight — parallel gate checks + the daemon-minted consent nonce (PLAN
 * §8.1 preflight.ts / §8.5.3). Returns checks + invocationEcho +
 * permissionSummary (from ProjectRunConfig — the single verbatim-stable consent
 * source) + needsFirstRunAck + lastRun + `consentNonce` iff no blocker.
 *
 * Auth-check row (Flaw F3): NOT faked. There is no verified zero-cost auth
 * probe (apiKeySource arrives AFTER spawn; a real `-p` call costs tokens).
 * We render `✓ claude CLI <ver> · auth verified at start` and rely on
 * spawn-time detection for ER-2 (fast fail + `claude login` hint).
 */
import { execFile } from "node:child_process";
import {
  EMPTY_ATTACHMENTS_DIGEST,
  attachmentsDigest,
  computeDiff as coreComputeDiff,
  extractAgentMentions,
  renderArtifacts,
  type CanonicalArtifact,
  type ProjectStore,
} from "@symbion/core";
import type { PreflightCheck, RunPreflightResult } from "../rpc/contract.js";
import { resolveRunConfig, configHash, ackSettingsHash, buildConsentSentence, buildAttachmentsSentence } from "./runConfig.js";
import { MIN_CLI_VERSION_FOR_ATTACHMENTS, buildArgv, cliSupportsAttachments, resolveClaudeBin } from "./cliDriver.js";
import { readTargetFiles } from "../fs/readTargetFiles.js";
import { gitStatus } from "../git/status.js";
import { nonceStore } from "./nonces.js";
import { listRuns, readRunJson } from "./runStore.js";

interface CliCheck {
  present: boolean;
  version: string | null;
}

/** Best-effort `claude --version` (argv array, 5s timeout — precedent git/status.ts). */
function checkCli(bin: string): Promise<CliCheck> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 5_000 }, (err, stdout) => {
      if (err) {
        resolve({ present: false, version: null });
        return;
      }
      // Output shape: "2.1.187 (Claude Code)".
      const match = /(\d+\.\d+\.\d+)/.exec(stdout);
      resolve({ present: true, version: match ? match[1]! : stdout.trim() });
    });
  });
}

export interface PreflightContext {
  projectId: string;
  projectRoot: string;
  artifactId: string;
  store: ProjectStore;
  /** whether runManager reports an active run for this project (BLOCK, ER-9). */
  hasActiveRun: boolean;
  /** validated image METADATA (run-image-paste) — binds the nonce to the exact images. */
  attachments?: { sha256: string; size: number; mediaType: string }[] | null;
}

export async function runPreflight(ctx: PreflightContext): Promise<RunPreflightResult> {
  const artifact = ctx.store.artifacts.find((a) => a.id === ctx.artifactId);
  const config = resolveRunConfig(ctx.store.settings);
  const bin = resolveClaudeBin();

  const checks: PreflightCheck[] = [];

  // 1. CLI presence + version (async).
  const cli = await checkCli(bin);
  if (!cli.present) {
    checks.push({
      id: "cli",
      severity: "block",
      label: "Claude Code CLI not found.",
      action: { label: "Install instructions", kind: "install" },
    });
  } else {
    // F3: auth is verified at spawn, not here.
    checks.push({
      id: "cli",
      severity: "ok",
      label: `claude CLI ${cli.version} · auth verified at start`,
    });
  }

  // 2. Active run (BLOCK, ER-9).
  if (ctx.hasActiveRun) {
    checks.push({ id: "active-run", severity: "block", label: "A run is already active in this project." });
  }

  // 3. Artifact published / draft (BLOCK) / conflict (WARN).
  if (!artifact) {
    checks.push({ id: "artifact", severity: "block", label: "Command not found in this project." });
  } else if (artifact.meta.status !== "published") {
    checks.push({
      id: "artifact",
      severity: "block",
      label: `/${artifact.name} is a DRAFT — nothing on disk to run.`,
      action: { label: "Publish first →", kind: "publish" },
    });
  } else {
    const conflict = detectConflict(ctx.projectRoot, ctx.store, artifact);
    if (conflict) {
      checks.push({
        id: "artifact",
        severity: "warn",
        label: `/${artifact.name} differs on disk (hand-edited) — the ON-DISK version runs.`,
      });
    } else {
      checks.push({ id: "artifact", severity: "ok", label: `/${artifact.name} published (${artifact.meta.version})` });
    }
  }

  // 4. Referenced agents published (WARN, ER-8).
  if (artifact) {
    const missing = missingReferencedAgents(ctx.store, artifact);
    if (missing.length > 0) {
      checks.push({
        id: "agents",
        severity: "warn",
        label: `agent${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not published — dispatch may fail mid-run.`,
      });
    } else {
      checks.push({ id: "agents", severity: "ok", label: "referenced agents published" });
    }
  }

  // 5. Git dirty (WARN).
  const git = gitStatus(ctx.projectRoot);
  if (git.isRepo && !git.clean) {
    checks.push({
      id: "git",
      severity: "warn",
      label: `git tree has ${git.changedFiles.length} uncommitted change${git.changedFiles.length === 1 ? "" : "s"} — rollback impossible; post-run diff will be noisy.`,
    });
  } else {
    checks.push({ id: "git", severity: "ok", label: "git tree clean" });
  }

  // 6. Image support (run-image-paste). Always reported; a BLOCK row only when
  //    images are actually attached to an unsupported CLI (text-only is unaffected).
  const attachments = ctx.attachments && ctx.attachments.length > 0 ? ctx.attachments : null;
  const supported = cli.present && cliSupportsAttachments(cli.version);
  const attachmentSupport: RunPreflightResult["attachmentSupport"] = {
    supported,
    minCliVersion: MIN_CLI_VERSION_FOR_ATTACHMENTS,
    ...(supported
      ? {}
      : {
          reason: cli.present
            ? `Images need claude CLI ${MIN_CLI_VERSION_FOR_ATTACHMENTS} or newer (installed: ${cli.version}).`
            : "Claude Code CLI not found.",
        }),
  };
  if (attachments && !supported) {
    checks.push({
      id: "attachments",
      severity: "block",
      label: `Images need claude CLI ${MIN_CLI_VERSION_FOR_ATTACHMENTS} or newer (installed: ${cli.version ?? "unknown"}) — remove the images or update the CLI.`,
      action: { label: "Re-check", kind: "recheck" },
    });
  }

  const blocked = checks.some((c) => c.severity === "block");

  // invocation echo — the exact argv (as a readable command line).
  const invocationEcho =
    artifact && cli.present
      ? `${bin} ${buildArgv({
          commandName: artifact.name,
          requirement: "<requirement>",
          model: undefined,
          permissionMode: config.permissionMode,
          allowedTools: config.allowedTools,
          inputMode: attachments ? "stdin" : "argv",
        })
          .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
          .join(" ")}${
          attachments
            ? ` <<< [${attachments.length} image${attachments.length === 1 ? "" : "s"} + "/${artifact.name} <requirement>"]`
            : ""
        }`
      : "";

  // configHash (permissionMode+allowedTools+ceilings) binds the nonce; the
  // first-run-ack comparison MUST use the narrower ackSettingsHash
  // (permissionMode+allowedTools only, ceilings excluded — design §0), because
  // that's the hash startRun persists into firstRunAck.settingsHash. Reusing
  // configHash here compares two different digests and can never match
  // (Defect 1 / QA J5 — ack reappeared on every run forever).
  const hash = configHash(config);
  const needsFirstRunAck = config.firstRunAck?.settingsHash !== ackSettingsHash(config);

  const permissionSummary = {
    mode: config.permissionMode,
    cwd: ctx.projectRoot,
    ceilings: config.ceilings,
    sentence: buildConsentSentence(ctx.projectRoot, config),
    ...(attachments
      ? {
          attachmentsSentence: buildAttachmentsSentence(
            attachments.length,
            attachments.reduce((n, a) => n + a.size, 0)
          ),
        }
      : {}),
  };

  const result: RunPreflightResult = {
    checks,
    blocked,
    needsFirstRunAck,
    invocationEcho,
    permissionSummary,
    attachmentSupport,
  };

  // lastRun hint (design R2, L3). RunListItem (from listRuns) doesn't carry
  // `requirement` — read the full run.json for that one field (Defect 2 / QA
  // J5: the requirement pre-fill was permanently empty because nothing upstream
  // ever surfaced it).
  const runs = listRuns(ctx.projectRoot);
  const lastTerminal = runs.find((r) => r.endedAt !== null);
  if (lastTerminal) {
    const fullRun = readRunJson(ctx.projectRoot, lastTerminal.runId);
    result.lastRun = {
      status: lastTerminal.status,
      durationMs: lastTerminal.durationMs,
      costUsd: lastTerminal.costUsd,
      endedAt: lastTerminal.endedAt,
      requirement: fullRun?.requirement ?? null,
    };
  }

  // consentNonce iff no blocker (AC-RUN-13: a blocked/draft artifact gets NO nonce).
  if (!blocked) {
    result.consentNonce = nonceStore.mint({
      projectId: ctx.projectId,
      artifactId: ctx.artifactId,
      configHash: hash,
      attachmentsDigest: attachments ? attachmentsDigest(attachments) : EMPTY_ATTACHMENTS_DIGEST,
    });
  }

  return result;
}

/** True iff the artifact's rendered file differs from what's on disk (a
 *  hand-edit since last publish). Best-effort — a render/read error → no warn. */
function detectConflict(projectRoot: string, store: ProjectStore, artifact: CanonicalArtifact): boolean {
  try {
    const targets = store.settings.defaultTargets;
    for (const target of targets) {
      const rendered = renderArtifacts([artifact], target, { version: artifact.meta.version });
      const relPaths = rendered.map((f) => f.relPath);
      const onDisk = readTargetFiles(projectRoot, relPaths);
      const diff = coreComputeDiff(rendered, onDisk);
      if (diff.some((f) => f.status === "conflict")) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function missingReferencedAgents(store: ProjectStore, artifact: CanonicalArtifact): string[] {
  const mentions = extractAgentMentions(artifact.body);
  const publishedAgents = new Set(
    store.artifacts.filter((a) => a.kind === "agent" && a.meta.status === "published").map((a) => a.name)
  );
  return mentions.filter((name) => !publishedAgents.has(name));
}
