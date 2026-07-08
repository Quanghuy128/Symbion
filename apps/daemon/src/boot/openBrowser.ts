import { exec } from "node:child_process";

/**
 * openBrowser.ts — extracted from `index.ts`'s inline best-effort
 * auto-open-in-browser logic (boot-terminal-ux PLAN §P1/§P0.3).
 *
 * Fixes two concrete bugs found while tracing the original code:
 *  1. `child_process.exec` was called with no callback at all, so any
 *     asynchronous failure (bad exit code, `ENOENT` — e.g. no default
 *     browser registered, `start`/`xdg-open` not on PATH) was never
 *     observable; the surrounding `try/catch` only guards the *synchronous*
 *     call to `exec` itself, not the async result. `openInBrowser` now
 *     always passes a callback and reports failures via `onFailure`.
 *  2. On Windows, the command was built as `start "<url>"` — `cmd.exe`'s
 *     `start` treats a single quoted argument as the window **title**, not
 *     the target, when it looks like it could be one. The conventional fix
 *     is `start "" "<url>"` (empty title first), which is what this module
 *     builds.
 */
export function openInBrowser(url: string, onFailure: (message: string) => void): void {
  try {
    const platform = process.platform;
    const cmd =
      platform === "darwin"
        ? `open "${url}"`
        : platform === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`;

    exec(cmd, (err) => {
      if (err) {
        onFailure(`Không tự mở được trình duyệt (${err.message}). Hãy mở thủ công đường dẫn ở trên.`);
      }
    });
  } catch (err) {
    // Defensive: exec() itself is not expected to throw synchronously, but
    // never let a browser-open attempt crash the boot menu loop either way.
    onFailure(
      `Không tự mở được trình duyệt (${(err as Error).message}). Hãy mở thủ công đường dẫn ở trên.`
    );
  }
}
