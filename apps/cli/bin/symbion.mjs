#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const VERSION = pkg.version;

const HELP = `Symbion v${VERSION} — local-daemon + web UI for authoring AI-coding autoworkflows

Usage:
  symbion                Start the daemon and open the boot menu
  symbion --version, -v  Print the installed version
  symbion --help, -h     Show this help message

Install: npm i -g @quanghuy128/symbion

Once running, the boot menu lets you open the Web UI in your browser,
hide the daemon to run in the background, or exit.

Docs: https://github.com/Quanghuy128/Symbion
`;

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

// Unknown/no flags: fall through to normal boot (design.md §3, §6 #2 locked).
process.env.SYMBION_VERSION = VERSION; // single source read once, passed down — daemon's
                                        // own index.ts prints the banner using this instead
                                        // of its own hardcoded literal (11.1.1).
await import("../apps/daemon/dist/index.js");
