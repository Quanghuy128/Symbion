# Symbion

**Visual builder for AI-coding autoworkflows.** Define slash-commands and subagents once through a web UI, then export/sync them into any target repo's `.claude/` folder (and `AGENTS.md` for Codex) — instead of hand-writing `.md` pipeline files for every new project.

## What problem this solves

AI-coding pipelines (analyze → design → plan → build → review → ship) are usually authored as a pile of hand-written `.md` files (`.claude/agents/*.md`, `.claude/commands/*.md`, `settings.json`, hooks). Every new repo means copy-pasting and re-tweaking those files by hand, with easy-to-miss frontmatter mistakes.

Symbion lets you define a workflow **once** as a canonical model (IR), then compiles it to whatever provider format you need and writes it safely into a target repo.

## MVP scope (v1)

- **Project management** — register a local repo path, manage multiple projects from a sidebar.
- **Workflow / Agent builder** — form-based editor (with a raw Markdown tab) for slash-commands and subagents, matching real Claude Code frontmatter (`name`, `description`, `tools`, etc.) plus custom fields.
- **Dependency graph** — read-only visualization of how commands/agents reference each other (not a drag-and-drop executor).
- **Export / Upsert ("Xuất bản")** — render the canonical model into provider-specific files and safely write/update them in the target repo:
  - **Claude Code**: `.claude/agents/*.md` + `.claude/commands/*.md`
  - **Codex**: `AGENTS.md`
- **Diff preview + conflict detection** — every publish renders → diffs against disk → asks for confirmation. Hand-edited "managed" files are detected via a marker/hash and never silently overwritten.
- **Import** — parse an existing `.claude/` folder into the model, so you don't start from a blank canvas.
- **Copy run command** — generates a structured prompt/CLI command to paste and run manually. Actual workflow *execution* is deferred to v2.

Out of scope for v1: running workflows automatically, multi-project shared libraries, providers beyond Claude/Codex (Copilot/Gemini are planned as future adapters with no IR changes needed).

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

## Running locally

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
```

## License

[MIT](LICENSE)
