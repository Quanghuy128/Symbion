/**
 * folderPick — best-effort native OS folder dialog. v1 has no native dialog
 * dependency wired in (no Electron/Tauri shell); the typed-path fallback in the
 * web UI is always available regardless, per STATE §8 #11 ("native OS dialog via
 * daemon, typed-path fallback always available"). This stub always reports
 * `cancelled` so the web UI deterministically falls back to the typed-path input.
 */
export interface BrowseFolderResult {
  path?: string;
  cancelled: boolean;
}

export async function browseFolder(_startPath?: string): Promise<BrowseFolderResult> {
  return { cancelled: true };
}
