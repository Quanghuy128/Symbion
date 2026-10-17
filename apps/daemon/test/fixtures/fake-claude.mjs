#!/usr/bin/env node
/**
 * fake-claude — a hermetic stand-in for the real `claude` CLI (testplan §0.2).
 * Selected via SYMBION_CLAUDE_BIN. Daemon tests NEVER spawn the real CLI ($0).
 *
 * argv belongs to cliDriver and must arrive UNTOUCHED — this script echoes it
 * verbatim for the injection assertions. Behavior driven by env vars:
 *
 *  --version                       -> prints "2.1.187 (Claude Code)" and exits 0.
 *  default                         -> streams FAKE_CLAUDE_FIXTURE line-by-line to
 *                                     stdout with FAKE_CLAUDE_DELAY_MS between lines
 *                                     (default 5), exits 0.
 *  FAKE_CLAUDE_ARGV_OUT=<path>     -> first writes process.argv.slice(2) as JSON.
 *  FAKE_CLAUDE_MODE=exit1          -> streams half the fixture, one stderr line, exit 1.
 *  FAKE_CLAUDE_MODE=hang           -> prints init then sleeps forever.
 *  FAKE_CLAUDE_MODE=ignore-sigterm -> installs a SIGTERM no-op, dies only on SIGKILL.
 *  FAKE_CLAUDE_MODE=spawn-child    -> spawns a grandchild that hangs, writes its pid
 *                                     to FAKE_CLAUDE_CHILD_PID_OUT, then hangs.
 *  FAKE_CLAUDE_MODE=huge           -> emits an assistant event with a 100 KB tool_use input.
 *  FAKE_CLAUDE_MODE=write-files    -> (P2, run-gitNumstat.test.ts) modifies one tracked file
 *                                     and creates one new untracked file in cwd, THEN streams
 *                                     the fixture and exits 0 (simulates an agent's real writes
 *                                     for the gitNumstat integration test).
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);

// --version probe (preflight + startRun cliVersion).
if (argv.includes("--version")) {
  process.stdout.write("2.1.187 (Claude Code)\n");
  process.exit(0);
}

const argvOut = process.env.FAKE_CLAUDE_ARGV_OUT;
if (argvOut) {
  writeFileSync(argvOut, JSON.stringify(argv));
}

const mode = process.env.FAKE_CLAUDE_MODE ?? "default";
const delayMs = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? "5");
const fixturePath = process.env.FAKE_CLAUDE_FIXTURE;

function readFixtureLines() {
  if (!fixturePath) return [];
  return readFileSync(fixturePath, "utf-8").trimEnd().split("\n").filter((l) => l.length > 0);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Keep the event loop alive indefinitely (an unresolved Promise does NOT). */
function hangForever() {
  return new Promise(() => {
    setInterval(() => {}, 1_000);
  });
}

async function streamLines(lines) {
  for (const line of lines) {
    process.stdout.write(line + "\n");
    if (delayMs > 0) await sleep(delayMs);
  }
}

async function main() {
  if (mode === "hang") {
    // print init then never exit.
    const lines = readFixtureLines();
    if (lines[0]) process.stdout.write(lines[0] + "\n");
    await hangForever();
    return;
  }

  if (mode === "ignore-sigterm") {
    process.on("SIGTERM", () => {
      /* no-op — only SIGKILL ends us */
    });
    const lines = readFixtureLines();
    if (lines[0]) process.stdout.write(lines[0] + "\n");
    await hangForever();
    return;
  }

  if (mode === "spawn-child") {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      stdio: "ignore",
      detached: false,
    });
    const pidOut = process.env.FAKE_CLAUDE_CHILD_PID_OUT;
    if (pidOut) writeFileSync(pidOut, String(child.pid));
    await hangForever();
    return;
  }

  if (mode === "exit1") {
    const lines = readFixtureLines();
    const half = lines.slice(0, Math.max(1, Math.floor(lines.length / 2)));
    await streamLines(half);
    process.stderr.write("fake-claude: simulated failure\n");
    process.exit(1);
    return;
  }

  if (mode === "huge") {
    const bigInput = { path: "x".repeat(100_000) };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_huge",
        model: "m",
        content: [{ type: "tool_use", id: "toolu_h", name: "Read", input: bigInput }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      parent_tool_use_id: null,
    });
    process.stdout.write(line + "\n");
    process.exit(0);
    return;
  }

  if (mode === "write-files") {
    // Modify a tracked file (append a line) + create one new untracked file —
    // deliberately touching REAL files under cwd (the test's scratch project
    // root, never the real Symbion repo) so run-gitNumstat.test.ts can assert
    // on finalize()'s gitNumstat() output.
    try {
      appendFileSync(join(process.cwd(), "README.md"), "\nmodified by fake-claude write-files mode\n");
    } catch {
      /* README.md may not exist in a given test project — non-fatal */
    }
    writeFileSync(join(process.cwd(), "new-file-from-agent.txt"), "hello from the agent\n");
    await streamLines(readFixtureLines());
    process.exit(0);
    return;
  }

  // default: stream the whole fixture, exit 0.
  await streamLines(readFixtureLines());
  process.exit(0);
}

main();
