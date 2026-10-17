/**
 * QA-only generator (workflow-agent-run testplan §0.1 / J10): writes
 * `fixture-big-2500.ndjson` next to this file for the fake CLI
 * (`FAKE_CLAUDE_FIXTURE=<abs path> FAKE_CLAUDE_DELAY_MS=2`).
 *
 *   npx vite-node apps/daemon/test/fixtures/gen-fixture-big.ts [count]
 *
 * The generated file is NOT committed (~0.8 MB); the deterministic source of
 * truth is `packages/core/test/run/helpers/bigRun.ts` (also used by U-T13).
 * Not part of the daemon build (tsconfig includes `src` only).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bigRunLines } from "../../../../packages/core/test/run/helpers/bigRun";

const count = Number(process.argv[2] ?? "2500");
const out = join(dirname(fileURLToPath(import.meta.url)), `fixture-big-${count}.ndjson`);
writeFileSync(out, `${bigRunLines(count).join("\n")}\n`);
process.stdout.write(`wrote ${count} lines -> ${out}\n`);
