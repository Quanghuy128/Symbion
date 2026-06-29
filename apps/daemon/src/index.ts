import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type DaemonServerHandle } from "./server.js";
import { showBootMenu } from "./boot/menu.js";
import { loadGlobalConfig, saveGlobalConfig } from "./store/store.js";
import { findOpenPort } from "./net/findOpenPort.js";

const VERSION = "0.1.0";

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

  const url = `http://127.0.0.1:${handle.port}/?t=${handle.token}`;
  console.log(`Symbion daemon đang chạy: ${url}`);

  let running = true;
  while (running) {
    const choice = await showBootMenu(url);
    if (choice === "web") {
      console.log(`Mở: ${url}`);
      // best-effort open in default browser; not critical-path for headless/CI runs.
      try {
        const open = await import("node:child_process");
        const platform = process.platform;
        const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
        open.exec(`${cmd} "${url}"`);
      } catch {
        // ignore — user can open the URL manually
      }
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
