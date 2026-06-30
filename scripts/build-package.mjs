#!/usr/bin/env node
// Stages the publishable apps/cli/ package layout per
// docs/loops/publish-to-npm-STATE.md PLAN §11.2. Run via `npm run build:package`.
//
// This script is build-then-stage, strictly additive: it never modifies
// `npm run build`'s own behavior, and it never touches anything outside
// apps/cli/ (the package this build owns).
//
// IMPORTANT: this script must NEVER invoke `npm publish` (only callers,
// e.g. CI or a developer, run `npm pack` / `npm publish --dry-run`
// themselves after this script finishes staging).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_DIR = join(ROOT, "apps", "cli");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function log(msg) {
  console.log(`[build-package] ${msg}`);
}

function fail(msg) {
  console.error(`[build-package] FAILED: ${msg}`);
  process.exit(1);
}

// Step 2 — propagate version from root package.json (single source of truth,
// PLAN §11.1.1) into apps/cli/package.json. Done before staging so the
// staged package.json always reflects the version that was just built.
function syncVersion() {
  const rootPkgPath = join(ROOT, "package.json");
  const cliPkgPath = join(CLI_DIR, "package.json");
  const rootPkg = readJson(rootPkgPath);
  const cliPkg = readJson(cliPkgPath);
  if (cliPkg.version !== rootPkg.version) {
    cliPkg.version = rootPkg.version;
    writeJson(cliPkgPath, cliPkg);
    log(`apps/cli/package.json version synced to ${rootPkg.version}`);
  } else {
    log(`apps/cli/package.json version already ${rootPkg.version}, no change`);
  }
}

// Step 3 — clean previous staged output (idempotent re-run guarantee).
function cleanStaged() {
  const staged = [join(CLI_DIR, "apps"), join(CLI_DIR, "node_modules")];
  for (const dir of staged) {
    rmSync(dir, { recursive: true, force: true });
  }
  log("cleaned apps/cli/apps and apps/cli/node_modules");
}

// Steps 4-5 — copy daemon dist + web static export into the staged sibling
// layout findWebStaticRoot() expects (unmodified function, PLAN §11.1).
function stageDaemonAndWeb() {
  const daemonDistSrc = join(ROOT, "apps", "daemon", "dist");
  const webOutSrc = join(ROOT, "apps", "web", "out");

  if (!existsSync(daemonDistSrc)) {
    fail(`missing ${daemonDistSrc} — run "npm run build" before "npm run build:package"`);
  }
  if (!existsSync(webOutSrc)) {
    fail(`missing ${webOutSrc} — run "npm run build" before "npm run build:package"`);
  }

  const daemonDistDest = join(CLI_DIR, "apps", "daemon", "dist");
  const webOutDest = join(CLI_DIR, "apps", "web", "out");

  mkdirSync(dirname(daemonDistDest), { recursive: true });
  cpSync(daemonDistSrc, daemonDistDest, { recursive: true });
  log(`copied ${daemonDistSrc} -> ${daemonDistDest}`);

  mkdirSync(dirname(webOutDest), { recursive: true });
  cpSync(webOutSrc, webOutDest, { recursive: true });
  log(`copied ${webOutSrc} -> ${webOutDest}`);
}

// Steps 6-7 (+ yaml, see BUILD notes) — vendor compiled workspace deps into
// apps/cli/node_modules/ so the published manifest never carries an
// unresolvable "*" workspace-protocol range (PLAN §11.1.2, R3).
function vendorPackage({ name, srcDir, extraPackageJsonFields = {}, stripDependencies = true }) {
  const srcDist = join(srcDir, "dist");
  if (!existsSync(srcDist)) {
    fail(`missing ${srcDist} — run "npm run build" before "npm run build:package"`);
  }
  const destRoot = join(CLI_DIR, "node_modules", ...name.split("/"));
  const destDist = join(destRoot, "dist");
  mkdirSync(destRoot, { recursive: true });
  cpSync(srcDist, destDist, { recursive: true });

  const srcPkg = readJson(join(srcDir, "package.json"));
  const vendoredPkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    type: srcPkg.type,
    main: srcPkg.main,
    ...(srcPkg.types ? { types: srcPkg.types } : {}),
    ...(srcPkg.exports ? { exports: srcPkg.exports } : {}),
    ...(srcPkg.sideEffects !== undefined ? { sideEffects: srcPkg.sideEffects } : {}),
    ...extraPackageJsonFields,
  };
  if (!stripDependencies && srcPkg.dependencies) {
    vendoredPkg.dependencies = srcPkg.dependencies;
  }
  // "private" is intentionally dropped — this copy is never itself published
  // standalone, it's an inert manifest sitting inside another package's tarball.
  writeJson(join(destRoot, "package.json"), vendoredPkg);
  log(`vendored ${name} -> ${destRoot}`);
}

function vendorWorkspaceDeps() {
  // @symbion/core has no internal workspace dependency to strip, but does
  // depend on the real npm package "yaml" at runtime (packages/core/src/
  // render/frontmatter.ts imports it, and packages/core/dist/index.js
  // re-exports that module eagerly via `export *`, so "yaml" is loaded as
  // soon as @symbion/core is loaded — this is reachable from daemon boot via
  // store.ts's import of @symbion/core). PLAN §11.1.2/§11.2 only named
  // @symbion/core and @symbion/rpc-types explicitly; vendoring "yaml" too is
  // a build-time addition that keeps the same "bundle, do not depend"
  // strategy consistent (no unresolvable dependency range survives into the
  // published manifest) rather than leaving a real npm dependency that would
  // need its own pinned version in apps/cli/package.json's "dependencies".
  vendorPackage({
    name: "@symbion/core",
    srcDir: join(ROOT, "packages", "core"),
    stripDependencies: false, // keep "yaml": "^2.9.0" — resolved by the vendored copy below
  });
  vendorPackage({
    name: "@symbion/rpc-types",
    srcDir: join(ROOT, "packages", "rpc-types"),
    stripDependencies: true, // drop "@symbion/core": "*" — resolved via sibling node_modules lookup, no separate dependency declaration needed
  });
  vendorYaml();
}

function vendorYaml() {
  const srcDir = join(ROOT, "node_modules", "yaml");
  if (!existsSync(srcDir)) {
    fail(`missing ${srcDir} — run "npm install" at the repo root before "npm run build:package"`);
  }
  const destDir = join(CLI_DIR, "node_modules", "yaml");
  mkdirSync(destDir, { recursive: true });
  cpSync(join(srcDir, "dist"), join(destDir, "dist"), { recursive: true });
  const utilJs = join(srcDir, "util.js");
  if (existsSync(utilJs)) cpSync(utilJs, join(destDir, "util.js"));
  // Strip dev-only fields from yaml's package.json so published tarball
  // doesn't carry devDependencies, scripts, browserslist, prettier config etc.
  const srcPkg = readJson(join(srcDir, "package.json"));
  const vendoredPkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    type: srcPkg.type,
    ...(srcPkg.main ? { main: srcPkg.main } : {}),
    ...(srcPkg.exports ? { exports: srcPkg.exports } : {}),
    ...(srcPkg.sideEffects !== undefined ? { sideEffects: srcPkg.sideEffects } : {}),
    license: srcPkg.license,
  };
  writeJson(join(destDir, "package.json"), vendoredPkg);
  log(`vendored yaml -> ${destDir}`);
}

// Step 8 — copy root README.md/LICENSE (single source of truth stays root,
// this is a copy step, not a second hand-maintained copy).
function copyDocs() {
  cpSync(join(ROOT, "README.md"), join(CLI_DIR, "README.md"));
  cpSync(join(ROOT, "LICENSE"), join(CLI_DIR, "LICENSE"));
  log("copied README.md and LICENSE into apps/cli/");
}

// Step 9 — verification: fail loudly if the staged layout is incomplete.
// This directly operationalizes Gate A's acceptance criterion (confirming
// findWebStaticRoot() will resolve to a path that exists).
function verify() {
  const daemonEntry = join(CLI_DIR, "apps", "daemon", "dist", "index.js");
  const webIndex = join(CLI_DIR, "apps", "web", "out", "index.html");
  const coreEntry = join(CLI_DIR, "node_modules", "@symbion", "core", "dist", "index.js");
  const rpcTypesEntry = join(CLI_DIR, "node_modules", "@symbion", "rpc-types", "dist", "index.js");
  const yamlEntry = join(CLI_DIR, "node_modules", "yaml", "package.json");

  const checks = [
    ["apps/daemon/dist/index.js", daemonEntry],
    ["apps/web/out/index.html", webIndex],
    ["node_modules/@symbion/core/dist/index.js", coreEntry],
    ["node_modules/@symbion/rpc-types/dist/index.js", rpcTypesEntry],
    ["node_modules/yaml/package.json", yamlEntry],
  ];

  const missing = checks.filter(([, path]) => !existsSync(path));
  if (missing.length > 0) {
    fail(
      `staged package layout is incomplete, missing: ${missing
        .map(([label]) => label)
        .join(", ")}`
    );
  }
  log("verified staged layout — all expected files present");
}

function main() {
  syncVersion();
  cleanStaged();
  stageDaemonAndWeb();
  vendorWorkspaceDeps();
  copyDocs();
  verify();
  log("done — apps/cli/ is ready for `npm pack` / `npm publish --dry-run` (run from apps/cli/)");
}

main();
