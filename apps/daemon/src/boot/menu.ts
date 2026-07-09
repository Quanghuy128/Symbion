import { createInterface } from "node:readline";

export type BootChoice = "web" | "terminal" | "tray" | "exit";

const MENU_LINE = "  1) Web UI   2) Hide to Tray   3) Exit";
const PROMPT = "  Choose (1-3): ";

/**
 * showBootMenu — S0 terminal boot menu. Compact single-line menu (Web UI /
 * Hide to Tray / Exit). The stubbed "Terminal UI (coming soon)" option is
 * hidden from the printed menu and the input mapping (not deleted from the
 * `BootChoice` type — see the type above) so re-enabling it in v1.5 is a
 * one-line change: re-add the menu-line text and an `if (choice === "2")
 * return resolve("terminal")`-shaped branch with a renumber.
 */
export async function showBootMenu(url: string): Promise<BootChoice> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = (): Promise<BootChoice> =>
    new Promise((resolve) => {
      console.log(MENU_LINE);
      rl.question(PROMPT, (answer) => {
        const choice = answer.trim();
        if (choice === "1") return resolve("web");
        if (choice === "2") return resolve("tray");
        if (choice === "3") return resolve("exit");
        console.log("  Invalid choice, please try again.\n");
        ask().then(resolve);
      });
    });

  const choice = await ask();

  rl.close();
  return choice;
}
