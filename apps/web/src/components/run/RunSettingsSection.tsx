"use client";

import { useState } from "react";
import { DEFAULT_RUN_CONFIG, type ProjectRunConfig } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface RunSettingsSectionProps {
  config: ProjectRunConfig | undefined;
  onSave: (config: ProjectRunConfig) => Promise<void>;
}

const MIN_WALL_CLOCK_MIN = 1;
const MAX_WALL_CLOCK_MIN = 1440;
const MIN_TOKEN_CAP = 1_000;
const MAX_TOKEN_CAP = 5_000_000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * RunSettingsSection — the real Settings→Execution editor (design §3.11 R7,
 * STATE §18.1). Permission mode / allowed-tools / ceilings, backed by the
 * EXISTING `updateSettings` RPC (no new RPC — R7 reuses it exactly, F-P3-3).
 *
 * Validation (EDGE-5): wall-clock clamped to [1, 1440] minutes; token cap
 * clamped to [1_000, 5_000_000] OR the explicit "no cap" toggle (round-trips
 * to `tokenCap<=0`, matching runManager.ts's existing `tokenCap > 0`
 * disable-check verbatim — no daemon-side change needed). `bypassPermissions`
 * requires an extra confirm-on-save modal AND clears any existing
 * `firstRunAck` (forces re-ask via the EXISTING ackSettingsHash-mismatch
 * mechanism the moment `permissionMode` changes — no new re-ask logic).
 */
export function RunSettingsSection({ config, onSave }: RunSettingsSectionProps) {
  const base = config ?? DEFAULT_RUN_CONFIG;
  const [mode, setMode] = useState<ProjectRunConfig["permissionMode"]>(base.permissionMode);
  const [allowedTools, setAllowedTools] = useState<string[]>(base.allowedTools);
  const [toolInput, setToolInput] = useState("");
  const [wallClockMin, setWallClockMin] = useState(Math.round(base.ceilings.wallClockMs / 60_000));
  const [noTokenCap, setNoTokenCap] = useState(base.ceilings.tokenCap <= 0);
  const [tokenCap, setTokenCap] = useState(base.ceilings.tokenCap > 0 ? base.ceilings.tokenCap : 200_000);
  const [confirmBypass, setConfirmBypass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addTool() {
    const trimmed = toolInput.trim();
    if (trimmed.length === 0) return;
    if (!allowedTools.includes(trimmed)) setAllowedTools((prev) => [...prev, trimmed]);
    setToolInput("");
  }

  function removeTool(tool: string) {
    setAllowedTools((prev) => prev.filter((t) => t !== tool));
  }

  function buildConfig(): ProjectRunConfig {
    const wallClockMs = clamp(wallClockMin, MIN_WALL_CLOCK_MIN, MAX_WALL_CLOCK_MIN) * 60_000;
    const tokenCapValue = noTokenCap ? 0 : clamp(tokenCap, MIN_TOKEN_CAP, MAX_TOKEN_CAP);
    const next: ProjectRunConfig = {
      permissionMode: mode,
      allowedTools,
      ceilings: { wallClockMs, tokenCap: tokenCapValue },
    };
    // bypassPermissions or a mode/tools change vs. what was last acked forces
    // a re-ask — clearing firstRunAck lets the EXISTING ackSettingsHash
    // mismatch mechanism (preflight.ts) do this automatically; no new logic.
    if (mode !== base.permissionMode || JSON.stringify(allowedTools) !== JSON.stringify(base.allowedTools)) {
      next.firstRunAck = undefined;
    } else {
      next.firstRunAck = base.firstRunAck;
    }
    return next;
  }

  async function handleSave() {
    if (mode === "bypassPermissions" && !confirmBypass) {
      setConfirmBypass(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(buildConfig());
      setConfirmBypass(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="execution" className="rounded-panel border border-border-hairline bg-bg-panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-text-strong">EXECUTION (used by ▶ Execute)</h3>

      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold text-text-muted">Permission mode</p>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-xs text-text-body">
            <input type="radio" name="run-permission-mode" checked={mode === "plan"} onChange={() => setMode("plan")} />
            <span>
              <span className="font-medium">plan</span> — read-only, agent proposes only
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-text-body">
            <input
              type="radio"
              name="run-permission-mode"
              checked={mode === "acceptEdits"}
              onChange={() => setMode("acceptEdits")}
            />
            <span>
              <span className="font-medium">acceptEdits</span> — edits files freely; unlisted shell commands
              still blocked
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-text-body">
            <input
              type="radio"
              name="run-permission-mode"
              checked={mode === "bypassPermissions"}
              onChange={() => setMode("bypassPermissions")}
            />
            <span>
              <span className="font-medium text-warning">bypassPermissions</span> — ⚠ everything allowed
              (extra confirm on save; first-run ack re-asked)
            </span>
          </label>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold text-text-muted">Allowed tools</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {allowedTools.map((tool) => (
            <span
              key={tool}
              className="flex items-center gap-1 rounded-pill bg-bg-code px-2 py-0.5 text-[11px] text-text-body"
            >
              {tool}
              <button type="button" className="text-text-faint hover:text-danger" onClick={() => removeTool(tool)}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            placeholder="e.g. Bash(npm test)"
            value={toolInput}
            onChange={(e) => setToolInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTool();
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={addTool}>
            + Add
          </Button>
        </div>
      </div>

      <div className="mb-2">
        <p className="mb-1 text-xs font-semibold text-text-muted">Ceilings</p>
        <div className="flex items-center gap-2 text-xs text-text-body">
          <span>wall clock (</span>
          <Input
            type="number"
            min={MIN_WALL_CLOCK_MIN}
            max={MAX_WALL_CLOCK_MIN}
            value={wallClockMin}
            onChange={(e) => setWallClockMin(clamp(Number(e.target.value) || MIN_WALL_CLOCK_MIN, MIN_WALL_CLOCK_MIN, MAX_WALL_CLOCK_MIN))}
            className="w-16 text-center"
          />
          <span>) min</span>
          <span className="ml-3">tokens (</span>
          <Input
            type="number"
            min={MIN_TOKEN_CAP}
            max={MAX_TOKEN_CAP}
            disabled={noTokenCap}
            value={tokenCap}
            onChange={(e) => setTokenCap(clamp(Number(e.target.value) || MIN_TOKEN_CAP, MIN_TOKEN_CAP, MAX_TOKEN_CAP))}
            className="w-24 text-center disabled:opacity-40"
          />
          <span>)</span>
          <label className="ml-3 flex items-center gap-1 text-[11px] text-text-muted">
            <input type="checkbox" checked={noTokenCap} onChange={(e) => setNoTokenCap(e.target.checked)} />
            no cap
          </label>
        </div>
      </div>

      <p className="mb-3 text-[11px] text-text-faint">ⓘ Every run still shows a confirm dialog.</p>

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>

      {confirmBypass && (
        <Dialog open onClose={() => setConfirmBypass(false)}>
          <DialogHeader>
            <DialogTitle>⚠ Allow bypassPermissions?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-body">
            The agent will be able to run ANY shell command and edit ANY file in this project without asking —
            this is the least-safe permission mode. The next run in this project will re-show the first-run
            acknowledgment.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBypass(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Confirm bypassPermissions"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
