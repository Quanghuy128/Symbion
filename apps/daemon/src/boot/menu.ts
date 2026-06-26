import { createInterface } from "node:readline";

export type BootChoice = "web" | "terminal" | "tray" | "exit";

const MENU_LINES = (url: string, version: string) => [
  "========================================",
  `  Symbion — Choose Interface (${version})`,
  `  Server: ${url}`,
  "========================================",
  "  1) Web UI (Open in Browser)",
  "  2) Terminal UI (Interactive CLI)",
  "  3) Hide to Tray (Background)",
  "  4) Exit",
  "----------------------------------------",
];

/**
 * showBootMenu — S0 terminal boot menu. All 4 options always shown; Terminal UI
 * is present-but-stubbed (prints a coming-soon notice and returns to menu),
 * per STATE §0/§8 #10 (v1 web-only).
 */
export async function showBootMenu(url: string, version: string): Promise<BootChoice> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = (): Promise<BootChoice> =>
    new Promise((resolve) => {
      for (const line of MENU_LINES(url, version)) {
        console.log(line);
      }
      rl.question("  Chọn (1-4): ", (answer) => {
        const choice = answer.trim();
        if (choice === "1") return resolve("web");
        if (choice === "2") return resolve("terminal");
        if (choice === "3") return resolve("tray");
        if (choice === "4") return resolve("exit");
        console.log("  Lựa chọn không hợp lệ, thử lại.\n");
        ask().then(resolve);
      });
    });

  const choice = await ask();

  if (choice === "terminal") {
    console.log("\n  Terminal UI — sắp có ở v1.5.\n");
    rl.close();
    return showBootMenu(url, version);
  }

  rl.close();
  return choice;
}
