"use client";

import { useEffect, useState } from "react";
import type { CanonicalArtifact } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderBrowserDialog } from "@/components/FolderBrowserDialog";
import { WorkflowDetectionPanel } from "@/components/WorkflowDetectionPanel";
import { ImportScanningState } from "@/components/ImportScanningState";
import { ImportReviewStep } from "@/components/ImportReviewStep";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import type { MakeDirParams, MakeDirResult, ScanClaudeDirResult, ValidatePathResult } from "@/lib/rpc/types";

export interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = "form" | "detected" | "scanning" | "review";

/**
 * Returns true if the scanned result actually contains something importable
 * (agents + commands + skipped > 0) — guards the empty-`.claude/`-dir
 * false-positive per PLAN §10.1.
 */
function hasImportableContent(parsed: ScanClaudeDirResult["parsed"]): boolean {
  return parsed.agents.length + parsed.commands.length + parsed.skipped.length > 0;
}

/** S3 — Create Project dialog: name + repo path, live validatePath, [Tạo] gated on validity.
 *  Also absorbs the existing-workflow detection + import flow (Issue #8). */
export function CreateProjectDialog({ open, onClose }: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [validation, setValidation] = useState<ValidatePathResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [creatingDir, setCreatingDir] = useState(false);
  const createProject = useArtifactStore((s) => s.createProject);
  const importArtifacts = useArtifactStore((s) => s.importArtifacts);
  const projects = useArtifactStore((s) => s.projects);

  const [step, setStep] = useState<Step>("form");
  const [declined, setDeclined] = useState(false);
  const [scanned, setScanned] = useState<ScanClaudeDirResult["parsed"] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);

  // EC-4 (PLAN §10.5): client-side short-circuit against the already-loaded
  // projects list. Daemon's own createProject `already-a-project` throw
  // remains the authoritative backstop.
  const alreadyAProject = projects.some((p) => p.path === path.trim());

  useEffect(() => {
    if (!path) {
      setValidation(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await callRpc<{ path: string }, ValidatePathResult>("validatePath", { path });
        setValidation(result);
      } catch {
        setValidation(null);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [path]);

  // Eager scan (PLAN §10.1): the moment validatePath reports a workflow and
  // the path isn't already a Symbion project, fire scanClaudeDir immediately
  // (no extra user click). Gate the detection panel on the scan actually
  // containing something importable, not on the raw hasClaudeDir boolean.
  useEffect(() => {
    // Path edited away mid-detection (design §5): reset to plain form
    // whenever validation no longer shows a workflow, unless we're mid
    // scan/review (path field is disabled in those steps so this can't fire).
    if (!validation || alreadyAProject || (!validation.hasClaudeDir && !validation.hasAgentsMd)) {
      if (step === "detected") {
        setStep("form");
        setScanned(null);
        setScanError(null);
      }
      return;
    }

    if (step !== "form" && step !== "detected") {
      // already scanning/reviewing for a previously-confirmed path — don't
      // re-trigger.
      return;
    }

    if (!validation.hasClaudeDir) {
      // AGENTS.md-only (Q5): no scan needed, just show the informational panel.
      setStep("detected");
      return;
    }

    let cancelled = false;
    setScanError(null);
    callRpc<{ path: string }, ScanClaudeDirResult>("scanClaudeDir", { path: path.trim() })
      .then((result) => {
        if (cancelled) return;
        if (hasImportableContent(result.parsed) || validation.hasAgentsMd) {
          setScanned(result.parsed);
          setSelected(new Set([...result.parsed.agents, ...result.parsed.commands].map((a) => a.id)));
          setStep("detected");
        } else {
          // Empty `.claude/` dir false positive (PLAN §10.1) — stay on plain form.
          setScanned(null);
          setStep("form");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setScanError(err instanceof Error ? err.message : String(err));
        setStep("detected");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validation, alreadyAProject]);

  const canCreate = name.trim().length > 0 && !!validation?.exists && validation.isDir && !creating;

  async function handleCreateDir() {
    const trimmed = path.trim();
    if (!trimmed) return;
    setCreatingDir(true);
    setError(null);
    try {
      await callRpc<MakeDirParams, MakeDirResult>("makeDir", { path: trimmed });
      // re-run the authoritative validatePath check rather than trusting the
      // client's "I just made this" claim — same pattern as the debounce effect.
      const result = await callRpc<{ path: string }, ValidatePathResult>("validatePath", { path: trimmed });
      setValidation(result);
    } catch (err) {
      if (err instanceof DaemonRpcError) {
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setCreatingDir(false);
    }
  }

  function resetAll() {
    setName("");
    setPath("");
    setValidation(null);
    setStep("form");
    setDeclined(false);
    setScanned(null);
    setSelected(new Set());
    setScanError(null);
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await createProject(name.trim(), path.trim());
      resetAll();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function handleDecline() {
    setStep("form");
    setDeclined(true);
    setScanned(null);
    setScanError(null);
  }

  function handleConfirm() {
    setStep("review");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImport() {
    if (!scanned) return;
    setCreating(true);
    setError(null);
    let createdProjectName: string | null = null;
    try {
      const project = await createProject(name.trim() || path.trim().split("/").filter(Boolean).pop() || "imported", path.trim());
      createdProjectName = project.name;
      const all: CanonicalArtifact[] = [...scanned.agents, ...scanned.commands];
      await importArtifacts({
        projectId: project.id,
        selectedIds: Array.from(selected),
        scanned: all,
      });
      resetAll();
      onClose();
    } catch (err) {
      const message = (err as Error).message;
      // Partial-failure UX (review §🟡): if createProject already succeeded
      // before importArtifacts threw, the project genuinely exists now —
      // tell the user that instead of letting them retry blindly into
      // "already-a-project".
      setError(
        createdProjectName
          ? `Dự án "${createdProjectName}" đã được tạo nhưng nhập thất bại: ${message}. Mở dự án "${createdProjectName}" trong danh sách bên trái để nhập lại bằng "Import .claude/ từ repo".`
          : message
      );
    } finally {
      setCreating(false);
    }
  }

  function handleRetryScan() {
    setScanError(null);
    setStep("form");
    // re-trigger the eager-scan effect by nudging validation reference;
    // simplest reliable way is to re-run validatePath.
    if (path.trim()) {
      callRpc<{ path: string }, ValidatePathResult>("validatePath", { path: path.trim() }).then(setValidation);
    }
  }

  const pathFieldDisabled = step === "scanning" || step === "review";

  return (
    <Dialog open={open} onClose={onClose} className="w-[480px]">
      <DialogHeader>
        <DialogTitle>{step === "review" ? "Tạo dự án mới — Xem lại trước khi nhập" : "Tạo dự án mới"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Tên dự án</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My API Service" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Đường dẫn repo</label>
          <div className="flex gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="…/code/my-service"
              disabled={pathFieldDisabled}
            />
            <Button variant="outline" onClick={() => setBrowserOpen(true)} disabled={pathFieldDisabled}>
              Chọn…
            </Button>
          </div>
          {validation && step === "form" && (
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {validation.reason === "unc-unsupported" ? (
                <span className="text-destructive">
                  ⚠ UNC paths (\\server\share\...) chưa được hỗ trợ. Hãy dùng đường dẫn ổ đĩa, ví dụ
                  C:\Users\me\code\my-service
                </span>
              ) : validation.exists ? (
                <span>
                  ✓ Thư mục tồn tại
                  {validation.hasClaudeDir
                    ? declined
                      ? " · .claude/ đã có (đã chọn tạo dự án trống)"
                      : " · .claude/ đã có (xem xét Import)"
                    : " · .claude/ chưa có"}
                </span>
              ) : (
                <>
                  <span>✗ Thư mục không tồn tại</span>
                  {path.trim().length > 0 && (
                    <Button size="sm" variant="outline" disabled={creatingDir} onClick={handleCreateDir}>
                      {creatingDir ? "Đang tạo…" : "Tạo thư mục này"}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {step === "detected" && !scanError && (
          <WorkflowDetectionPanel
            hasClaudeDir={!!validation?.hasClaudeDir}
            hasAgentsMd={!!validation?.hasAgentsMd}
            importAvailable={!!validation?.hasClaudeDir && !!scanned}
            onConfirm={handleConfirm}
            onDecline={handleDecline}
          />
        )}

        {step === "detected" && scanError && (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="text-destructive">⚠ Quét .claude/ thất bại: {scanError}</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={handleDecline}>
                Tạo dự án trống
              </Button>
              <Button size="sm" onClick={handleRetryScan}>
                Thử lại
              </Button>
            </div>
          </div>
        )}

        {step === "scanning" && <ImportScanningState />}

        {step === "review" && scanned && <ImportReviewStep scanned={scanned} selected={selected} onToggle={toggle} />}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        {step === "form" && (
          <Button disabled={!canCreate} onClick={handleCreate}>
            Tạo dự án
          </Button>
        )}
        {step === "review" && (
          <>
            <Button variant="outline" onClick={() => setStep("detected")}>
              Quay lại
            </Button>
            <Button disabled={selected.size === 0 || creating} onClick={handleImport}>
              Nhập {selected.size} mục đã chọn
            </Button>
          </>
        )}
      </DialogFooter>

      <FolderBrowserDialog
        open={browserOpen}
        initialPath={path.trim().length > 0 && validation?.isDir ? path.trim() : undefined}
        onPick={(p) => {
          setPath(p);
          setBrowserOpen(false);
        }}
        onClose={() => setBrowserOpen(false)}
      />
    </Dialog>
  );
}
