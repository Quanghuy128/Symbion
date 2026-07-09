import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type DaemonServerHandle } from "./server.js";
import { showBootMenu } from "./boot/menu.js";
import { loadGlobalConfig, saveGlobalConfig } from "./store/store.js";
import { findOpenPort } from "./net/findOpenPort.js";
import { buildBootBanner, isTtyOutput, supportsEmoji } from "./boot/banner.js";
import { openInBrowser } from "./boot/openBrowser.js";

const VERSION = process.env.SYMBION_VERSION ?? "0.1.0";

/**
 * printBootBanner — reads the process-global environment exactly once
 * (isTTY / columns / env / platform) and delegates to the pure
 * `buildBootBanner`/`supportsEmoji` in ./boot/banner.ts, then prints each
 * returned line. Called exactly once, before the boot menu loop starts —
 * never inside it (boot-terminal-ux Scope decision #3 / PLAN §P1: the
 * banner must never be redrawn on menu retry, which is enforced by
 * apps/daemon/test/menu.test.ts's TC-MENU-5/TC-MENU-6 regression guards).
 */
function printBootBanner(version: string, url: string): void {
  const isTty = isTtyOutput(process.stdout);
  const lines = buildBootBanner({
    version,
    url,
    useEmoji: supportsEmoji(process.env, process.platform),
    isTty,
    terminalColumns: process.stdout.columns,
  });
  for (const line of lines) {
    console.log(line);
  }
}

function findWebStaticRoot(): string | undefined {
  // apps/daemon/dist/index.js -> ../../web/out (apps/web/out, the Next static export).
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = join(here, "..", "..", "web", "out");
  return existsSync(candidate) ? candidate : undefined;
}

async function main() {
  const config = loadGlobalConfig();
  const webStaticRoot = findWebStaticRoot();

  let handle: DaemonServerHandle;
  let port: number;
  try {
    const found = await findOpenPort(config.port, (candidatePort) =>
      startServer({ port: candidatePort, version: VERSION, webStaticRoot })
    );
    port = found.port;
    handle = found.handle;
  } catch (err) {
    console.error("Không tìm được cổng trống cho daemon.", err);
    process.exit(1);
    return;
  }

  if (port !== config.port) {
    config.port = port;
    saveGlobalConfig(config);
  }

  const url = `http://127.0.0.1:${handle.port}/`;
  printBootBanner(VERSION, url);

  let running = true;
  while (running) {
    const choice = await showBootMenu(url);
    if (choice === "web") {
      console.log(`Mở: ${url}`);
      // best-effort open in default browser; not critical-path for headless/CI runs.
      // Failures are now surfaced via the onFailure callback (FR-A.3 fix —
      // previously a silent try/catch around a fire-and-forget exec() call
      // that could never observe an async failure at all).
      openInBrowser(url, (message) => console.log(message));
    } else if (choice === "tray") {
      console.log("Đã chuyển sang chạy nền (Hide to Tray). Server vẫn đang chạy.");
      running = false; // detach menu loop; process keeps running via the HTTP server
    } else if (choice === "exit") {
      console.log("Đang tắt daemon...");
      await handle.close();
      running = false;
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
