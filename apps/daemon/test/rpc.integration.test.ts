import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handlers } from "../src/rpc/handlers.js";
import { PathConfinementError, resolveConfinedPath } from "../src/rpc/guard.js";
import { loadProjectStore } from "../src/store/store.js";

let configDir: string;
let projectRoot: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "symbion-config-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  projectRoot = mkdtempSync(join(tmpdir(), "symbion-project-"));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env["SYMBION_CONFIG_DIR"];
});

const ctx = { port: 20128, version: "0.1.0" };

describe("T1 createProject", () => {
  it("writes <tmp>/.symbion/store.json and registers project in global config", async () => {
    const result = await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    expect(result.project.schemaVersion).toBe(1);
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(true);

    const projects = await handlers.listProjects({}, ctx);
    expect(projects.projects).toHaveLength(1);
    expect(projects.projects[0]!.path).toBe(projectRoot);
  });
});

describe("T2 validatePath", () => {
  it("existing dir -> exists+isDir true", () => {
    const res = handlers.validatePath({ path: projectRoot }, ctx);
    expect(res.exists).toBe(true);
    expect(res.isDir).toBe(true);
  });

  it("with .claude/ -> hasClaudeDir true", () => {
    mkdirSync(join(projectRoot, ".claude"));
    const res = handlers.validatePath({ path: projectRoot }, ctx);
    expect(res.hasClaudeDir).toBe(true);
  });

  it("non-git -> isGitRepo false", () => {
    const res = handlers.validatePath({ path: projectRoot }, ctx);
    expect(res.isGitRepo).toBe(false);
  });

  it("missing path -> exists false", () => {
    const res = handlers.validatePath({ path: join(projectRoot, "nope") }, ctx);
    expect(res.exists).toBe(false);
  });

  it("Windows-style drive-absolute path (well-formed, doesn't exist on this host) -> exists false, no reason", () => {
    const res = handlers.validatePath({ path: "C:\\Users\\me\\nonexistent-repo" }, ctx);
    expect(res).toEqual({
      exists: false,
      isDir: false,
      isGitRepo: false,
      hasClaudeDir: false,
      hasAgentsMd: false,
      writable: false,
    });
    expect(res.reason).toBeUndefined();
  });

  it("UNC path -> reason: unc-unsupported, all other fields false", () => {
    const res = handlers.validatePath({ path: "\\\\fileserver\\teams\\my-service" }, ctx);
    expect(res).toEqual({
      exists: false,
      isDir: false,
      isGitRepo: false,
      hasClaudeDir: false,
      hasAgentsMd: false,
      writable: false,
      reason: "unc-unsupported",
    });
  });

  it("forward-slash drive-absolute variant -> same shape as backslash variant (mixed-separator tolerance)", () => {
    const res = handlers.validatePath({ path: "C:/Users/me/code/my-service" }, ctx);
    expect(res.exists).toBe(false);
    expect(res.reason).toBeUndefined();
  });

  it("existing Unix-style dir still validates correctly (regression guard for new UNC branch)", () => {
    const res = handlers.validatePath({ path: projectRoot }, ctx);
    expect(res.exists).toBe(true);
    expect(res.isDir).toBe(true);
    expect(res.reason).toBeUndefined();
  });
});

const FIXTURES_DIR = fileURLToPath(
  new URL("../../../packages/core/test/fixtures/claude", import.meta.url)
);

function dropFixtureClaudeDir(root: string) {
  const fixturesDir = FIXTURES_DIR;
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  mkdirSync(join(root, ".claude", "commands"), { recursive: true });
  writeFileSync(join(root, ".claude", "agents", "ba.md"), readFileSync(join(fixturesDir, "agents/ba.md")));
  writeFileSync(
    join(root, ".claude", "agents", "code-reviewer.md"),
    readFileSync(join(fixturesDir, "agents/code-reviewer.md"))
  );
  writeFileSync(join(root, ".claude", "agents", "broken.md"), readFileSync(join(fixturesDir, "agents/broken.md")));
  writeFileSync(
    join(root, ".claude", "commands", "analyze.md"),
    readFileSync(join(fixturesDir, "commands/analyze.md"))
  );
}

describe("T3 scan -> IR", () => {
  it("scanClaudeDir returns 2 agents, 1 command, skipped includes broken.md", () => {
    dropFixtureClaudeDir(projectRoot);
    const result = handlers.scanClaudeDir({ path: projectRoot });
    expect(result.parsed.agents).toHaveLength(2);
    expect(result.parsed.commands).toHaveLength(1);
    expect(result.parsed.skipped.some((s) => s.relPath.includes("broken.md"))).toBe(true);
  });

  it("importArtifacts writes selected scan results into store.json", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    dropFixtureClaudeDir(projectRoot);
    const scanned = handlers.scanClaudeDir({ path: projectRoot });
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    const all = [...scanned.parsed.agents, ...scanned.parsed.commands];
    const result = handlers.importArtifacts(
      { projectId, selectedIds: all.map((a) => a.id), scanned: all },
      ctx
    );
    expect(result.project.artifacts).toHaveLength(3);
  });
});

async function setupProjectWithArtifacts() {
  await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
  const projects = await handlers.listProjects({}, ctx);
  const projectId = projects.projects[0]!.id;

  const agent = {
    id: "agent-1",
    kind: "agent" as const,
    name: "ba",
    description: "Business analyst",
    tools: ["Read", "Grep"],
    body: "You are BA.",
    meta: { version: "draft", status: "draft" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  };
  const command = {
    id: "cmd-1",
    kind: "command" as const,
    name: "analyze",
    description: "analyze step",
    body: "Request: $ARGUMENTS",
    meta: { version: "draft", status: "draft" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  };
  handlers.saveArtifact({ projectId, artifact: agent }, ctx);
  handlers.saveArtifact({ projectId, artifact: command }, ctx);
  return { projectId };
}

describe("T4 scan->render->diff->write (happy path)", () => {
  it("writes .claude/agents + .claude/commands with markers; publish log appended; publishedHashes set", async () => {
    const { projectId } = await setupProjectWithArtifacts();

    const diff = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.1.0" }, ctx);
    expect(diff.files.every((f) => f.status === "new")).toBe(true);

    const write = handlers.write(
      {
        projectId,
        targets: ["claude"],
        version: "v0.1.0",
        files: diff.files.map((f) => ({ relPath: f.relPath })),
      },
      ctx
    );

    expect(write.results.filter((r) => r.action === "created")).toHaveLength(2);
    expect(existsSync(join(projectRoot, ".claude", "agents", "ba.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".claude", "commands", "analyze.md"))).toBe(true);
    expect(readFileSync(join(projectRoot, ".claude", "agents", "ba.md"), "utf-8")).toContain("managed-by: symbion");

    expect(existsSync(join(projectRoot, ".symbion", "publish-log.json"))).toBe(true);
    const log = JSON.parse(readFileSync(join(projectRoot, ".symbion", "publish-log.json"), "utf-8"));
    expect(log).toHaveLength(1);

    const store = loadProjectStore(projectRoot);
    const ba = store.artifacts.find((a) => a.id === "agent-1");
    expect(ba?.meta.publishedHashes?.claude).toBeTruthy();
    expect(ba?.meta.status).toBe("published");
  });
});

describe("T5 idempotent re-publish (AC-E2)", () => {
  it("re-running computeDiff after a write returns all same, empty write set", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    const diff1 = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.1.0" }, ctx);
    handlers.write(
      { projectId, targets: ["claude"], version: "v0.1.0", files: diff1.files.map((f) => ({ relPath: f.relPath })) },
      ctx
    );

    const diff2 = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.1.0" }, ctx);
    expect(diff2.files.every((f) => f.status === "same")).toBe(true);
  });
});

describe("T6 conflict path (AC-E3)", () => {
  it("hand-edited file -> conflict, unchecked write does not overwrite; resolution:overwrite does", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    const diff1 = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.1.0" }, ctx);
    handlers.write(
      { projectId, targets: ["claude"], version: "v0.1.0", files: diff1.files.map((f) => ({ relPath: f.relPath })) },
      ctx
    );

    const baPath = join(projectRoot, ".claude", "agents", "ba.md");
    const original = readFileSync(baPath, "utf-8");
    writeFileSync(baPath, original.replace("You are BA.", "You are BA. HAND EDITED."));

    const diff2 = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.2.0" }, ctx);
    const baDiff = diff2.files.find((f) => f.relPath === ".claude/agents/ba.md");
    expect(baDiff?.status).toBe("conflict");

    // write without resolution -> file NOT overwritten
    const writeNoRes = handlers.write(
      { projectId, targets: ["claude"], version: "v0.2.0", files: diff2.files.map((f) => ({ relPath: f.relPath })) },
      ctx
    );
    const baResultNoRes = writeNoRes.results.find((r) => r.relPath === ".claude/agents/ba.md");
    expect(baResultNoRes?.action).toBe("skipped-conflict");
    expect(readFileSync(baPath, "utf-8")).toContain("HAND EDITED");

    // write WITH resolution:overwrite -> overwritten, new hash recorded
    const writeWithRes = handlers.write(
      {
        projectId,
        targets: ["claude"],
        version: "v0.2.0",
        files: diff2.files.map((f) => ({
          relPath: f.relPath,
          resolution: f.relPath === ".claude/agents/ba.md" ? "overwrite" : undefined,
        })),
      },
      ctx
    );
    const baResultWithRes = writeWithRes.results.find((r) => r.relPath === ".claude/agents/ba.md");
    expect(baResultWithRes?.action).toBe("updated");
    expect(readFileSync(baPath, "utf-8")).not.toContain("HAND EDITED");
  });
});

describe("T7 foreign file (AC-E1/E2)", () => {
  it("unmarked foreign file never appears in write set, never modified", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    mkdirSync(join(projectRoot, ".claude", "agents"), { recursive: true });
    const foreignPath = join(projectRoot, ".claude", "agents", "foreign.md");
    writeFileSync(foreignPath, "---\nname: foreign\ndescription: hand written, not Studio managed\n---\nHello.");

    const diff = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.1.0" }, ctx);
    expect(diff.files.some((f) => f.relPath === ".claude/agents/foreign.md")).toBe(false);

    handlers.write(
      { projectId, targets: ["claude"], version: "v0.1.0", files: diff.files.map((f) => ({ relPath: f.relPath })) },
      ctx
    );
    expect(readFileSync(foreignPath, "utf-8")).toBe(
      "---\nname: foreign\ndescription: hand written, not Studio managed\n---\nHello."
    );
  });
});

describe("T8 backup-before-write", () => {
  it("writing an existing managed file copies prior content to .symbion/backups/<version>/...", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    const diff1 = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.1.0" }, ctx);
    handlers.write(
      { projectId, targets: ["claude"], version: "v0.1.0", files: diff1.files.map((f) => ({ relPath: f.relPath })) },
      ctx
    );

    // bump version + change body -> triggers an update on the existing file
    handlers.saveArtifact(
      {
        projectId,
        artifact: {
          id: "agent-1",
          kind: "agent",
          name: "ba",
          description: "Business analyst",
          tools: ["Read", "Grep"],
          body: "You are BA, updated.",
          meta: { version: "draft", status: "draft", createdAt: "x", updatedAt: "x" },
        },
      },
      ctx
    );

    const diff2 = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.2.0" }, ctx);
    handlers.write(
      { projectId, targets: ["claude"], version: "v0.2.0", files: diff2.files.map((f) => ({ relPath: f.relPath })) },
      ctx
    );

    const backupPath = join(projectRoot, ".symbion", "backups", "v0.2.0", ".claude", "agents", "ba.md");
    expect(existsSync(backupPath)).toBe(true);

    const manifestPath = join(projectRoot, ".symbion", "backups", "v0.2.0", "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const baEntry = manifest.files.find((f: { relPath: string }) => f.relPath === ".claude/agents/ba.md");
    expect(baEntry.existedBefore).toBe(true);
  });
});

describe("T9 init .claude/ (E13)", () => {
  it("write creates .claude/agents + .claude/commands when absent", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    expect(existsSync(join(projectRoot, ".claude"))).toBe(false);

    const diff = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.1.0" }, ctx);
    handlers.write(
      { projectId, targets: ["claude"], version: "v0.1.0", files: diff.files.map((f) => ({ relPath: f.relPath })) },
      ctx
    );

    expect(existsSync(join(projectRoot, ".claude", "agents"))).toBe(true);
    expect(existsSync(join(projectRoot, ".claude", "commands"))).toBe(true);
  });
});

describe("T10 Codex merge", () => {
  it("writes single AGENTS.md with fenced managed region; foreign content preserved", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    writeFileSync(join(projectRoot, "AGENTS.md"), "# Pre-existing notes\n\nHand-written context.");

    const diff = handlers.computeDiff({ projectId, targets: ["codex"], version: "v0.1.0" }, ctx);
    handlers.write(
      { projectId, targets: ["codex"], version: "v0.1.0", files: diff.files.map((f) => ({ relPath: f.relPath })) },
      ctx
    );

    const content = readFileSync(join(projectRoot, "AGENTS.md"), "utf-8");
    expect(content).toContain("# Pre-existing notes");
    expect(content).toContain("region-start");
    expect(content).toContain("## Agent: ba");
    expect(content).toContain("## Command: /analyze");
  });

  it("flags firstPublishIntoForeignMergedFile on first-ever publish into a pre-existing foreign AGENTS.md (STATE §3.4)", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    writeFileSync(join(projectRoot, "AGENTS.md"), "# Pre-existing notes\n\nHand-written context.");

    const diff = handlers.computeDiff({ projectId, targets: ["codex"], version: "v0.1.0" }, ctx);
    const agentsMdFile = diff.files.find((f) => f.relPath === "AGENTS.md");
    expect(agentsMdFile).toBeDefined();
    expect(agentsMdFile!.status).not.toBe("conflict");
    expect(agentsMdFile!.conflictClass).toBe("clean");
    expect(agentsMdFile!.firstPublishIntoForeignMergedFile).toBe(true);
  });

  it("does NOT flag firstPublishIntoForeignMergedFile on a normal re-publish of an already-managed AGENTS.md", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    writeFileSync(join(projectRoot, "AGENTS.md"), "# Pre-existing notes\n\nHand-written context.");

    const firstDiff = handlers.computeDiff({ projectId, targets: ["codex"], version: "v0.1.0" }, ctx);
    handlers.write(
      {
        projectId,
        targets: ["codex"],
        version: "v0.1.0",
        files: firstDiff.files.map((f) => ({ relPath: f.relPath })),
      },
      ctx
    );

    const secondDiff = handlers.computeDiff({ projectId, targets: ["codex"], version: "v0.1.0" }, ctx);
    const agentsMdFile = secondDiff.files.find((f) => f.relPath === "AGENTS.md");
    expect(agentsMdFile).toBeDefined();
    expect(agentsMdFile!.status).toBe("same");
    expect(agentsMdFile!.firstPublishIntoForeignMergedFile).toBe(false);
  });
});

describe("Server-side validation on mutation (defense in depth)", () => {
  it("saveArtifact rejects a blocking-invalid artifact (missing required name) with RpcError", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    const invalid = {
      id: "agent-invalid",
      kind: "agent" as const,
      name: "",
      description: "",
      body: "",
      meta: {
        version: "draft",
        status: "draft" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    expect(() => handlers.saveArtifact({ projectId, artifact: invalid }, ctx)).toThrow();

    const store = loadProjectStore(projectRoot);
    expect(store.artifacts.some((a) => a.id === "agent-invalid")).toBe(false);
  });

  it("saveArtifact rejects a duplicate name (same kind) against existing artifacts", async () => {
    const { projectId } = await setupProjectWithArtifacts();
    const dup = {
      id: "agent-dup",
      kind: "agent" as const,
      name: "ba", // collides with the existing "ba" agent from setupProjectWithArtifacts
      description: "Duplicate BA",
      body: "Body.",
      meta: {
        version: "draft",
        status: "draft" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    expect(() => handlers.saveArtifact({ projectId, artifact: dup }, ctx)).toThrow();
  });

  it("importArtifacts rejects a selection that would create a blocking lint error", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    const invalidScan = [
      {
        id: "imported-invalid",
        kind: "agent" as const,
        name: "", // missing required name -> blocking error
        description: "desc",
        body: "body",
        meta: {
          version: "draft",
          status: "draft" as const,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ];

    expect(() =>
      handlers.importArtifacts(
        { projectId, selectedIds: ["imported-invalid"], scanned: invalidScan },
        ctx
      )
    ).toThrow();

    const store = loadProjectStore(projectRoot);
    expect(store.artifacts.some((a) => a.id === "imported-invalid")).toBe(false);
  });
});

describe("T11 path confinement (E14)", () => {
  it("rejects relPath escaping project root via ..", () => {
    expect(() => resolveConfinedPath(projectRoot, "../escape.md")).toThrow(PathConfinementError);
  });

  it("rejects absolute paths", () => {
    expect(() => resolveConfinedPath(projectRoot, "/etc/passwd")).toThrow(PathConfinementError);
  });

  it("rejects symlink escape", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "symbion-outside-"));
    const linkPath = join(projectRoot, "escape-link");
    symlinkSync(outsideDir, linkPath);
    try {
      expect(() => resolveConfinedPath(projectRoot, "escape-link/file.md")).toThrow(PathConfinementError);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects Windows-style backslash traversal (..\\..\\escape.md)", () => {
    expect(() => resolveConfinedPath(projectRoot, "..\\..\\escape.md")).toThrow(PathConfinementError);
  });

  it("rejects Windows-style multi-segment traversal (..\\..\\windows\\system32)", () => {
    expect(() => resolveConfinedPath(projectRoot, "..\\..\\windows\\system32")).toThrow(PathConfinementError);
  });

  it("rejects Windows-style drive-absolute path as absolute-and-disallowed", () => {
    expect(() => resolveConfinedPath(projectRoot, "C:\\Users\\me\\repo")).toThrow(PathConfinementError);
  });

  it("rejects UNC-style path as absolute-and-disallowed", () => {
    expect(() => resolveConfinedPath(projectRoot, "\\\\server\\share\\file.md")).toThrow(PathConfinementError);
  });

  it("rejects mixed-separator traversal (..\\../escape.md)", () => {
    expect(() => resolveConfinedPath(projectRoot, "..\\../escape.md")).toThrow(PathConfinementError);
  });

  it("rejects Windows-style traversal that does not start with .. (subdir\\..\\..\\escape.md)", () => {
    expect(() => resolveConfinedPath(projectRoot, "subdir\\..\\..\\escape.md")).toThrow(PathConfinementError);
  });

  it("does not false-positive on a filename containing a literal '..' substring", () => {
    expect(() => resolveConfinedPath(projectRoot, "my..file.md")).not.toThrow();
  });
});

describe("T12 partial failure (E10)", () => {
  it("makes one target file unwritable; write returns that file error, others succeed", async () => {
    if (process.getuid && process.getuid() === 0) {
      // chmod-based permission tests are meaningless when running as root.
      return;
    }
    const { projectId } = await setupProjectWithArtifacts();
    const agentsDir = join(projectRoot, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(join(projectRoot, ".claude", "commands"), { recursive: true });
    chmodSync(agentsDir, 0o555); // read+execute only, no write

    try {
      const diff = handlers.computeDiff({ projectId, targets: ["claude"], version: "v0.1.0" }, ctx);
      const write = handlers.write(
        { projectId, targets: ["claude"], version: "v0.1.0", files: diff.files.map((f) => ({ relPath: f.relPath })) },
        ctx
      );
      const baResult = write.results.find((r) => r.relPath === ".claude/agents/ba.md");
      const cmdResult = write.results.find((r) => r.relPath === ".claude/commands/analyze.md");
      expect(baResult?.action).toBe("error");
      expect(cmdResult?.action).toBe("created");
    } finally {
      chmodSync(agentsDir, 0o755);
    }
  });
});

describe("T13 store migration", () => {
  it("refuses to write when schemaVersion is newer than supported", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const storePath = join(projectRoot, ".symbion", "store.json");
    const store = JSON.parse(readFileSync(storePath, "utf-8"));
    store.schemaVersion = 999;
    writeFileSync(storePath, JSON.stringify(store));

    expect(() => loadProjectStore(projectRoot)).toThrow(/mới hơn/);
  });
});

describe("T14 gitStatus", () => {
  it("non-repo -> isRepo:false", () => {
    const result = handlers.gitStatus({ path: projectRoot }, ctx);
    expect(result.isRepo).toBe(false);
  });

  it("clean repo -> clean:true", () => {
    execSync("git init -q", { cwd: projectRoot });
    execSync("git -c user.email=t@t.com -c user.name=t commit --allow-empty -q -m init", { cwd: projectRoot });
    const result = handlers.gitStatus({ path: projectRoot }, ctx);
    expect(result.isRepo).toBe(true);
    expect(result.clean).toBe(true);
  });

  it("dirty repo -> lists changed files", () => {
    execSync("git init -q", { cwd: projectRoot });
    execSync("git -c user.email=t@t.com -c user.name=t commit --allow-empty -q -m init", { cwd: projectRoot });
    writeFileSync(join(projectRoot, "new-file.txt"), "hello");
    const result = handlers.gitStatus({ path: projectRoot }, ctx);
    expect(result.clean).toBe(false);
    expect(result.changedFiles.length).toBeGreaterThan(0);
  });
});

describe("renderRunCommand RPC", () => {
  it("delegates to core pure function", () => {
    const result = handlers.renderRunCommand(
      { command: "autoplan", requirements: "Add emoji reactions", model: "claude-opus-4-8", option: "--gate" },
      ctx
    );
    expect(result.prompt).toBe("/autoplan Add emoji reactions [claude-opus-4-8] [--gate]");
  });
});

describe("applyTemplate RPC (templates-marketplace)", () => {
  function baseTemplate(overrides: Partial<{
    sourceTemplateId: string;
    kind: "agent" | "command";
    name: string;
    description: string;
    tools?: string[];
    body: string;
  }> = {}) {
    return {
      sourceTemplateId: "agent:code-reviewer",
      kind: "agent" as const,
      name: "code-reviewer",
      description: "Rà soát code, gắn nhãn rủi ro bảo mật & style.",
      tools: ["Read", "Grep"],
      body: "You are a meticulous code reviewer.",
      ...overrides,
    };
  }

  it("D1: applies a valid agent template with no collision -> wasRenamed false, draft status, sourceTemplateId set", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    const result = handlers.applyTemplate({ projectId, template: baseTemplate() }, ctx);

    expect(result.wasRenamed).toBe(false);
    expect(result.finalName).toBe("code-reviewer");
    expect(result.project.artifacts).toHaveLength(1);
    const applied = result.project.artifacts.find((a) => a.id === result.appliedArtifactId);
    expect(applied?.meta.status).toBe("draft");
    expect(applied?.meta.sourceTemplateId).toBe("agent:code-reviewer");
    expect(applied?.name).toBe("code-reviewer");
  });

  it("D2: applying with an existing same-name-same-kind artifact -> auto-suffixed, original untouched", async () => {
    const { projectId } = await setupProjectWithArtifacts(); // has agent "ba", command "analyze"
    const result = handlers.applyTemplate(
      { projectId, template: baseTemplate({ name: "ba", kind: "agent" }) },
      ctx
    );
    expect(result.wasRenamed).toBe(true);
    expect(result.finalName).toBe("ba-2");

    const original = result.project.artifacts.find((a) => a.id === "agent-1");
    expect(original?.name).toBe("ba");
    expect(original?.body).toBe("You are BA.");
  });

  it("D2b: collisions through -2/-3 already taken -> first free suffix (-4)", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    handlers.applyTemplate({ projectId, template: baseTemplate({ name: "x" }) }, ctx);
    handlers.applyTemplate({ projectId, template: baseTemplate({ name: "x" }) }, ctx);
    handlers.applyTemplate({ projectId, template: baseTemplate({ name: "x" }) }, ctx);
    const result = handlers.applyTemplate({ projectId, template: baseTemplate({ name: "x" }) }, ctx);

    expect(result.finalName).toBe("x-4");
  });

  it("D2c: collision scoping is (kind, name) — an existing agent doesn't block a command of the same name", async () => {
    const { projectId } = await setupProjectWithArtifacts(); // agent "ba", command "analyze"
    const result = handlers.applyTemplate(
      { projectId, template: baseTemplate({ name: "ba", kind: "command", tools: undefined }) },
      ctx
    );
    expect(result.wasRenamed).toBe(false);
    expect(result.finalName).toBe("ba");
  });

  it("D3: writes ONLY .symbion/store.json — no .claude/ or AGENTS.md file appears", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    handlers.applyTemplate({ projectId, template: baseTemplate() }, ctx);

    expect(existsSync(join(projectRoot, ".claude"))).toBe(false);
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(true);
  });

  it("D4: template.kind 'skill' (simulated client bug) -> throws RpcError, nothing persisted", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    expect(() =>
      handlers.applyTemplate(
        { projectId, template: baseTemplate({ kind: "skill" as unknown as "agent" }) },
        ctx
      )
    ).toThrow();

    const store = loadProjectStore(projectRoot);
    expect(store.artifacts).toHaveLength(0);
  });

  it("D5: empty/whitespace-only name -> throws RpcError, nothing persisted", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    expect(() =>
      handlers.applyTemplate({ projectId, template: baseTemplate({ name: "   " }) }, ctx)
    ).toThrow();
    expect(loadProjectStore(projectRoot).artifacts).toHaveLength(0);
  });

  it("D5b: empty description -> throws RpcError, nothing persisted", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    expect(() =>
      handlers.applyTemplate({ projectId, template: baseTemplate({ description: "" }) }, ctx)
    ).toThrow();
    expect(loadProjectStore(projectRoot).artifacts).toHaveLength(0);
  });

  it("D6: unknown projectId -> throws the same not-found error class as other project-scoped RPCs", () => {
    expect(() => handlers.applyTemplate({ projectId: "nonexistent", template: baseTemplate() }, ctx)).toThrow();
  });

  it("D8: re-applying the SAME template to the SAME project twice -> two independent draft artifacts, neither overwritten", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    const first = handlers.applyTemplate({ projectId, template: baseTemplate() }, ctx);
    const second = handlers.applyTemplate({ projectId, template: baseTemplate() }, ctx);

    expect(first.finalName).toBe("code-reviewer");
    expect(second.finalName).toBe("code-reviewer-2");
    expect(second.project.artifacts).toHaveLength(2);
    expect(second.project.artifacts.some((a) => a.id === first.appliedArtifactId)).toBe(true);
  });

  it("D9: server-side validateAllArtifacts re-check blocks a name that fails FILENAME_SAFE_RE even though auto-suffix wouldn't catch it", async () => {
    await handlers.createProject({ name: "demo", path: projectRoot }, ctx);
    const projects = await handlers.listProjects({}, ctx);
    const projectId = projects.projects[0]!.id;

    expect(() =>
      handlers.applyTemplate(
        { projectId, template: baseTemplate({ name: "bad name with spaces" }) },
        ctx
      )
    ).toThrow();
    expect(loadProjectStore(projectRoot).artifacts).toHaveLength(0);
  });
});
