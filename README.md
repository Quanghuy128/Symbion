# Symbion

**Visual builder for AI-coding autoworkflows.** Define slash-commands and subagents once through a web UI, then export/sync them into any target repo's `.claude/` folder (and `AGENTS.md` for Codex) — instead of hand-writing `.md` pipeline files for every new project.

## What problem this solves

AI-coding pipelines (analyze → design → plan → build → review → ship) are usually authored as a pile of hand-written `.md` files (`.claude/agents/*.md`, `.claude/commands/*.md`, `settings.json`, hooks). Every new repo means copy-pasting and re-tweaking those files by hand, with easy-to-miss frontmatter mistakes.

Symbion lets you define a workflow **once** as a canonical model (IR), then compiles it to whatever provider format you need and writes it safely into a target repo.

## MVP scope (v1)

- **Project management** — register a local repo path, manage multiple projects from a sidebar.
- **Workflow / Agent builder** — form-based editor (with a raw Markdown tab) for slash-commands and subagents, matching real Claude Code frontmatter (`name`, `description`, `tools`, etc.) plus custom fields.
- **Dependency graph** — a self-coded graph of how commands/agents reference each other (auto-layout, connect-by-drag authoring, draggable nodes). It is a map, not a drag-and-drop executor.
- **Export / Upsert ("Xuất bản")** — render the canonical model into provider-specific files and safely write/update them in the target repo:
  - **Claude Code**: `.claude/agents/*.md` + `.claude/commands/*.md`
  - **Codex**: `AGENTS.md`
- **Diff preview + conflict detection** — every publish renders → diffs against disk → asks for confirmation. Hand-edited "managed" files are detected via a marker/hash and never silently overwritten.
- **Import** — parse an existing `.claude/` folder into the model, so you don't start from a blank canvas.
- **Copy run command** — generates a structured prompt/CLI command to paste and run manually.
- **Run from the graph** — execute one *published* command through your local `claude` CLI (headless, `stream-json`) with a requirement, a preflight check and a consent step. One active run per project; per-project permission mode, tool allow-list and time/token ceilings; cancel with **Stop run**.
- **Agents panel** — while a run is live (and for any past run in History, read-only) a right-hand panel shows the agent tree: the command, its subagents and background tasks with status, duration and tokens. Click an agent (or its node on the graph) for its prompt, one-line tool calls with expandable capped previews, and its result. History keeps the last 50 runs per project, stored in the repo's gitignored `.symbion/runs/`.

Out of scope: chaining commands into pipelines, stopping a single subagent (headless CLI limit), executing through Codex, multi-project shared libraries, providers beyond Claude/Codex (Copilot/Gemini are planned as future adapters with no IR changes needed).

See [docs/loops/symbion-analyze.md](docs/loops/symbion-analyze.md), [symbion-design.md](docs/loops/symbion-design.md), and [symbion-STATE.md](docs/loops/symbion-STATE.md) for the full locked spec, design, and architecture.

## Architecture

```
apps/web      Next.js UI — project sidebar, builder forms, dependency graph, publish dialog
apps/daemon   Node process — the ONLY thing that touches disk/git. Exposes localhost RPC
packages/core Pure TS — canonical IR, render/parse, diff, marker/hash, provider adapters
```

- `packages/core` has no filesystem/network imports — it's the compiler (IR ↔ Claude/Codex format).
- `apps/daemon` binds to `127.0.0.1` only, owns all reads/writes/git access, and is the sole place where side effects happen.
- `apps/web` is presentation only; every effect goes through a typed RPC call to the daemon.

## Requirements

- Node.js >= 18
- npm

## Installation

Install Symbion globally to use it as a CLI tool from any directory:

```bash
npm install -g @andrew.ng/symbion
```

Or add it as a project dependency and run it via `npx`:

```bash
npm install @andrew.ng/symbion
npx symbion
```

## Usage

Once installed, run:

```bash
symbion
```

This starts the local Symbion daemon and opens an interactive menu:

```
  1) Web UI   2) Hide to Tray   3) Exit
```

- **Web UI** opens the Symbion web app in your default browser, served
  locally by the daemon (nothing is sent to any external server — Symbion
  runs entirely on `127.0.0.1`).
- **Hide to Tray** keeps the daemon running in the background so you can
  keep using your terminal.
- **Exit** shuts the daemon down.

Other commands:

```bash
symbion --version   # print the installed version
symbion --help      # show usage help
```

## Running from a clone (contributing / local development)

```bash
npm install
npm start
```

`npm start` builds and boots the daemon, which prints a terminal menu:

```
========================================
  Choose Interface (v0.1.0)
  Server: http://localhost:<port>
========================================
  Web UI (Open in Browser)
  Exit
```

Pick **Web UI** to open the app in your browser at the printed `localhost` URL.

### Development

```bash
npm run dev:daemon   # daemon in watch mode
npm run dev:web      # Next.js dev server
```

### Tests

```bash
npm test             # all unit tests (vitest)
npm run test:core    # packages/core only
npm run test:daemon  # apps/daemon only
npm run test:e2e     # build + Playwright end-to-end
npm run test:web     # apps/web component tests
```

## License

[MIT](LICENSE)
