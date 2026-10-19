"use client";

import { useRef, useState } from "react";
import { DaemonRpcError } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import type {
  InspectTemplateSourceUrlOutcome,
  SourceFolder,
  UserTemplateSourceSummary,
} from "@/lib/rpc/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { AuthorFetchErrorPanel } from "./AuthorFetchErrorPanel";
import { TemplateSourceMappingForm, initialFolders } from "./TemplateSourceMappingForm";

type InspectSuccess = Extract<InspectTemplateSourceUrlOutcome, { status: "success" }>;
type InspectError = Extract<InspectTemplateSourceUrlOutcome, { status: "error" }>;
type Step = "url" | "inspecting" | "review";

export interface AddTemplateSourceDialogProps {
  daemonConnected: boolean;
  onClose: () => void;
  /** a source was saved — parent re-lists, selects and loads the new tab. */
  onAdded: (source: UserTemplateSourceSummary) => void;
  /** "Already added" -> switch to that (saved or built-in) tab. */
  onOpenExisting: (id: string) => void;
}

/**
 * AddTemplateSourceDialog — paste a GitHub link -> daemon inspects it ->
 * review/map folders -> save (docs/loops/templates-repo-url-STATE.md §8.7).
 * All validation is authoritative on the DAEMON; this UI never builds a
 * GitHub URL and never sends owner/repo (only the opaque inspect token).
 */
export function AddTemplateSourceDialog({ daemonConnected, onClose, onAdded, onOpenExisting }: AddTemplateSourceDialogProps) {
  const inspectTemplateSourceUrl = useArtifactStore((s) => s.inspectTemplateSourceUrl);
  const addTemplateSource = useArtifactStore((s) => s.addTemplateSource);

  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [inspectError, setInspectError] = useState<InspectError | null>(null);
  const [info, setInfo] = useState<InspectSuccess | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [folders, setFolders] = useState<SourceFolder[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Auto re-inspect after `inspect-expired` happens at most once per submit.
  const reinspected = useRef(false);

  async function runInspect(): Promise<InspectSuccess | null> {
    setStep("inspecting");
    setUrlError(null);
    setInspectError(null);
    setAddError(null);
    try {
      const res = await inspectTemplateSourceUrl({ url });
      if (res.outcome.status === "error") {
        setInspectError(res.outcome);
        setStep("url");
        return null;
      }
      setInfo(res.outcome);
      setStep("review");
      return res.outcome;
    } catch (err) {
      setUrlError(err instanceof DaemonRpcError || err instanceof Error ? err.message : "Could not check that link.");
      setStep("url");
      return null;
    }
  }

  async function handleCheck(e?: React.FormEvent) {
    e?.preventDefault();
    if (url.trim().length === 0 || !daemonConnected) return;
    const ok = await runInspect();
    if (ok) {
      setDisplayName(ok.suggestedDisplayName);
      setFolders(initialFolders(ok.detected));
    }
  }

  async function submit(token: string) {
    setSubmitting(true);
    setAddError(null);
    try {
      const res = await addTemplateSource({
        inspectToken: token,
        displayName: displayName.trim().length > 0 ? displayName.trim() : undefined,
        folders,
      });
      onAdded(res.source);
    } catch (err) {
      const code = err instanceof DaemonRpcError ? err.code : "";
      if (code === "inspect-expired" && !reinspected.current) {
        reinspected.current = true;
        const fresh = await runInspect();
        if (fresh) {
          setNotice("The link check had expired and was refreshed.");
          await submit(fresh.inspectToken);
          return;
        }
      } else if (code === "inspect-expired") {
        setAddError("The link check expired. Go back and check the link again.");
      } else {
        setAddError(err instanceof Error ? err.message : "Could not add the source.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleAdd() {
    if (!info || folders.length === 0 || !daemonConnected) return;
    reinspected.current = false;
    void submit(info.inspectToken);
  }

  return (
    <Dialog open onClose={onClose} className="w-[560px]">
      <DialogHeader>
        <DialogTitle>Add template source</DialogTitle>
        <DialogClose onClose={onClose} />
      </DialogHeader>

      {step !== "review" && (
        <>
          <DialogBody>
            {step === "inspecting" ? (
              <p className="py-6 text-ui text-ink-3" role="status">
                Reading repository…
              </p>
            ) : (
              <form onSubmit={handleCheck} className="space-y-3">
                <Field
                  label="GitHub link"
                  htmlFor="source-url"
                  help="Public GitHub repositories only"
                  error={urlError ?? undefined}
                >
                  <Input
                    id="source-url"
                    autoFocus
                    value={url}
                    aria-invalid={urlError ? true : undefined}
                    placeholder="https://github.com/owner/repo or …/tree/branch/folder"
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setUrlError(null);
                    }}
                  />
                </Field>
                {inspectError && (
                  <AuthorFetchErrorPanel
                    kind={inspectError.kind}
                    message={inspectError.message}
                    resetAt={inspectError.resetAt}
                    onRetry={() => void handleCheck()}
                  />
                )}
              </form>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={url.trim().length === 0 || step === "inspecting" || !daemonConnected}
              onClick={() => void handleCheck()}
            >
              Check
            </Button>
          </DialogFooter>
        </>
      )}

      {step === "review" && info && (
        <>
          <DialogBody className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption text-ink-3">
              <dt>Repository</dt>
              <dd className="text-ink">
                {info.owner}/{info.repo}
              </dd>
              <dt>Branch / tag</dt>
              <dd className="text-ink">{info.refLabel}</dd>
              <dt>Folder</dt>
              <dd className="font-mono text-code text-ink">{info.rootPath ? `/${info.rootPath}` : "(repository root)"}</dd>
              <dt>Commit</dt>
              <dd className="font-mono text-code text-ink">{info.commitSha.slice(0, 7)}</dd>
            </dl>
            {info.truncated && (
              <p className="text-caption text-warning">
                ⚠ This repository is very large; GitHub returned a partial file listing, so some folders may be missing.
              </p>
            )}

            {info.duplicateOf ? (
              <div className="space-y-2">
                <p className="text-ui text-ink">Already added as &quot;{info.duplicateOf.displayName}&quot;.</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    onOpenExisting(info.duplicateOf!.id);
                    onClose();
                  }}
                >
                  Open tab
                </Button>
              </div>
            ) : (
              <>
                <Field label="Display name" htmlFor="source-name">
                  <Input
                    id="source-name"
                    value={displayName}
                    maxLength={60}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </Field>
                {info.detected.length === 0 && (
                  <p className="text-caption text-warning">
                    No agents / commands / skills folders were found automatically. Choose which folders to use.
                  </p>
                )}
                <TemplateSourceMappingForm
                  rootDirs={info.rootDirs}
                  detected={info.detected}
                  value={folders}
                  onChange={setFolders}
                />
                <p className="flex items-center gap-2 text-caption text-ink-3">
                  <Badge variant="warning">Unverified</Badge>
                  This source will be marked Unverified.
                </p>
              </>
            )}
            {notice && <p className="text-caption text-ink-muted">{notice}</p>}
            {addError && (
              <p className="text-caption text-danger-text" role="alert">
                {addError}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setStep("url");
                setNotice(null);
                setAddError(null);
              }}
            >
              Back
            </Button>
            {!info.duplicateOf && (
              <Button disabled={folders.length === 0 || submitting || !daemonConnected} onClick={handleAdd}>
                {submitting ? "Adding…" : "Add source"}
              </Button>
            )}
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
